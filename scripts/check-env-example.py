#!/usr/bin/env python3
"""Fails if the dashboard reads an environment variable that
apps/elliot-dashboard/.env.example doesn't list, or lists one nothing reads.

.env.example is the checklist for Vercel (see RELEASING.md), so a variable
missing from it is a variable someone will forget to set.
"""
import pathlib
import re
import sys

APP = pathlib.Path(__file__).resolve().parent.parent / "apps" / "elliot-dashboard"
BUILTIN = {"NODE_ENV", "NEXT_RUNTIME", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "CI"}

used = set()
for path in list((APP / "app").rglob("*.ts*")) + list((APP / "lib").rglob("*.ts*")) + [APP / "middleware.ts"]:
    text = path.read_text(encoding="utf-8")
    used |= set(re.findall(r"process\.env\.([A-Z][A-Z0-9_]+)", text))
    # Names passed around as strings, e.g. callInternalWebhook("N8N_..._URL").
    used |= set(re.findall(r"[\"'`]((?:N8N|NEXT_PUBLIC)_[A-Z0-9_]+)[\"'`]", text))
used -= BUILTIN

listed = set(re.findall(r"^([A-Z][A-Z0-9_]+)=", (APP / ".env.example").read_text(encoding="utf-8"), re.M))

missing = sorted(used - listed)
unused = sorted(listed - used)
for name in missing:
    print(f"{name} is read by the dashboard but not listed in apps/elliot-dashboard/.env.example")
for name in unused:
    print(f"{name} is listed in apps/elliot-dashboard/.env.example but nothing reads it")
if missing or unused:
    sys.exit(1)
print(f"All {len(used)} environment variables the dashboard reads are listed in .env.example.")
