#!/usr/bin/env python3
"""Checks every SQL query inside the n8n workflow files against the database
the migrations build.

Postgres plans each query (PREPARE) without running it: a table, column or
function that a workflow uses but the migrations don't have, a wrong
argument type, or a typo is an error here instead of a failed run in n8n.

Run by db/test/run.sh after the migrations. Takes the database name as its
only argument; connection details come from PGHOST / PGUSER / PGPASSWORD.
"""
import glob
import json
import os
import re
import subprocess
import sys

DB = sys.argv[1]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def plan(sql: str) -> str:
    """'' if Postgres can plan it, otherwise the error."""
    body = sql.strip().rstrip(";").strip()
    script = f"begin;\nprepare elliot_check as\n{body};\nrollback;\n"
    r = subprocess.run(
        ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB],
        input=script, capture_output=True, text=True,
    )
    if r.returncode == 0:
        return ""
    return next((l for l in r.stderr.splitlines() if "ERROR" in l), r.stderr.strip()[:300])


failures = []
checked = 0
for path in sorted(glob.glob(os.path.join(ROOT, "n8n", "workflows", "[0-9][0-9]-*.json"))):
    wf = json.load(open(path, encoding="utf-8"))
    name = os.path.basename(path)
    for node in wf["nodes"]:
        if node["type"] != "n8n-nodes-base.postgres":
            continue
        p = node["parameters"]
        if "query" in p:
            sql = p.get("query", "")
            if sql.startswith("="):
                failures.append(f"{name} \"{node['name']}\": the query is an n8n expression, so it can't be checked; pass values as $1, $2 … instead")
                continue
            err = plan(sql)
        else:
            # Insert / update / select on a table: the table and every mapped
            # column must exist.
            table = p.get("table")
            table = table.get("value") if isinstance(table, dict) else table
            cols = list(((p.get("columns") or {}).get("value") or {}).keys())
            if not table:
                err = "no table chosen"
            else:
                err = plan(f"select {', '.join(cols) if cols else '*'} from public.{table} limit 0")
        checked += 1
        if err:
            failures.append(f"{name} \"{node['name']}\": {err.replace('psql:<stdin>:', '')}")

for f in failures:
    print(f"  FAIL {f}")
print(f"  {'ok  ' if not failures else 'FAIL'} {checked - len(failures)} of {checked} workflow queries match the database")
sys.exit(1 if failures else 0)
