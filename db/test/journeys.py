#!/usr/bin/env python3
"""The seven customer journeys, run against the database the migrations build,
using the real SQL from the n8n workflow files.

Each step takes the query straight out of the workflow JSON (the same text
n8n sends to Supabase) and runs it with the values n8n would pass. What it
can't cover: Claude's answers, Google Calendar, Resend and Meta. Those are
outside the database, and are tested from the workflow files in
n8n/workflows/tests/.

  A  Buyer enquiry        conversation, visitor, lead scored, listings found
  B  Appointment          booked, no double booking per calendar, reminder once
  C  Appointment changes  only the client's own viewing; move checks clashes; cancel once
  D  Seller enquiry       valuation request becomes a hot seller lead
  E  Human takeover       escalation, an agent takes over, Elliot stands back
  F  Follow-up            a due step is handed out once; STOP ends it
  G  Two agencies         neither sees or changes the other's data

Run by db/test/run.sh. Takes the database name as its only argument.
"""
import datetime
import glob
import json
import os
import subprocess
import sys
import uuid
from zoneinfo import ZoneInfo

DB = sys.argv[1]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
WARSAW = ZoneInfo("Europe/Warsaw")

# ── helpers ─────────────────────────────────────────────────


def workflow_query(prefix: str, node: str) -> str:
    path = glob.glob(os.path.join(ROOT, "n8n", "workflows", f"{prefix}-*.json"))[0]
    for n in json.load(open(path, encoding="utf-8"))["nodes"]:
        if n["name"] == node:
            return n["parameters"]["query"]
    raise KeyError(f"{prefix} has no node {node!r}")


def lit(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "'true'" if v else "'false'"
    if isinstance(v, (dict, list)):
        v = json.dumps(v)
    return "'" + str(v).replace("'", "''") + "'"


def psql(script: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["psql", "-X", "-q", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-d", DB],
        input=script, capture_output=True, text=True,
    )


def run(sql: str, params=(), as_user: str | None = None) -> list[list[str]]:
    """Run one query the way n8n does (parameters typed by Postgres), return rows."""
    who = ""
    if as_user:
        who = (
            "set local role authenticated;\n"
            f"select set_config('request.jwt.claim.sub', {lit(as_user)}, true) \\g /dev/null\n"
            "select set_config('request.jwt.claims', '{\"aal\":\"aal1\"}', true) \\g /dev/null\n"
        )
    body = sql.strip().rstrip(";")
    args = f"({', '.join(lit(p) for p in params)})" if params else ""
    script = f"begin;\n{who}prepare step as\n{body};\n\\echo __rows__\nexecute step{args};\ncommit;\n"
    r = psql(script)
    if r.returncode != 0:
        raise RuntimeError(next((l for l in r.stderr.splitlines() if "ERROR" in l), r.stderr))
    out = r.stdout.split("__rows__\n", 1)[1]
    return [line.split("\t") for line in out.splitlines() if line != ""]


def fails(sql: str, params=(), as_user: str | None = None) -> str:
    try:
        run(sql, params, as_user)
    except RuntimeError as e:
        return str(e)
    return ""


def one(sql: str, params=(), as_user: str | None = None) -> str:
    rows = run(sql, params, as_user)
    return rows[0][0] if rows and rows[0] else ""


def sql(text: str) -> list[list[str]]:
    return run(text)


passed = 0


def check(cond: bool, what: str):
    global passed
    if not cond:
        raise AssertionError(what)
    passed += 1


def journey(name: str):
    """Runs the scenario as soon as it is defined; stops at the first failure."""
    def wrap(fn):
        try:
            fn()
            print(f"  ok   {name}")
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL {name}: {e}")
            sys.exit(1)
        return fn
    return wrap


# ── two agencies ────────────────────────────────────────────
tag = uuid.uuid4().hex[:8]
A, B = str(uuid.uuid4()), str(uuid.uuid4())
AGENT_A, AGENT_B = str(uuid.uuid4()), str(uuid.uuid4())
L1, L2, L3, LB = (str(uuid.uuid4()) for _ in range(4))
psql(f"""
insert into tenants (id, name, slug, timezone) values
  ('{A}', 'Journey Agency A', 'journey-a-{tag}', 'Europe/Warsaw'),
  ('{B}', 'Journey Agency B', 'journey-b-{tag}', 'Europe/Warsaw');
insert into ai_config (tenant_id, google_calendar_id) values ('{A}', 'agency-a@group.calendar.google.com'), ('{B}', 'agency-b@group.calendar.google.com')
  on conflict (tenant_id) do update set google_calendar_id = excluded.google_calendar_id;
insert into auth.users (id, email) values ('{AGENT_A}', 'ola-{tag}@agency-a.pl'), ('{AGENT_B}', 'piotr-{tag}@agency-b.pl');
insert into tenant_users (tenant_id, auth_user_id, email, role, full_name, google_calendar_id) values
  ('{A}', '{AGENT_A}', 'ola-{tag}@agency-a.pl', 'agent', 'Ola', 'ola@agency-a.pl'),
  ('{B}', '{AGENT_B}', 'piotr-{tag}@agency-b.pl', 'agent', 'Piotr', 'piotr@agency-b.pl');
insert into listings (id, tenant_id, reference, title, transaction_type, property_type, price, city, district, rooms) values
  ('{L1}', '{A}', 'A-1', '2-room flat, Mokotów', 'sale', 'apartment', 690000, 'Warszawa', 'Mokotów', 2),
  ('{L2}', '{A}', 'A-2', 'Penthouse, Mokotów', 'sale', 'apartment', 2400000, 'Warszawa', 'Mokotów', 4),
  ('{L3}', '{A}', 'A-3', 'Flat to rent, Wola', 'rent', 'apartment', 4200, 'Warszawa', 'Wola', 2),
  ('{LB}', '{B}', 'B-1', 'Agency B flat, Mokotów', 'sale', 'apartment', 650000, 'Warszawa', 'Mokotów', 2);
""").check_returncode()

state: dict[str, str] = {}
tomorrow = datetime.datetime.now(WARSAW).date() + datetime.timedelta(days=1)


def at(hour: int, minute: int = 0) -> str:
    return datetime.datetime.combine(tomorrow, datetime.time(hour, minute), WARSAW).isoformat()


print("Customer journeys (real workflow SQL)")


@journey("A  buyer enquiry: conversation, visitor, lead scored hot, matching listings only")
def scenario_a():
    t = one(workflow_query("01", "Resolve Tenant"), [f"journey-a-{tag}"])
    check(t == A, "01 Resolve Tenant finds the agency by its slug")
    conv = one(workflow_query("01", "Get or Create Conversation"), [A, None])
    check(len(conv) == 36, "01 starts a conversation")
    one(workflow_query("01", "Log User Message"), [A, conv, "Hi, do you have 2-room flats in Mokotów under 800,000?"])
    visitor = json.loads(one(workflow_query("01", "Identify Visitor"), [A, conv, "Anna Nowak", "anna.journey@example.com", "", False]))
    check(visitor.get("verified") is False, "a website visitor is not a verified identity")
    contact = one(workflow_query("10", "Upsert Contact"),
                  [A, "Anna Nowak", "anna.journey@example.com", "+48 600 100 200", "", "chat_widget", conv])
    check(len(contact) == 36, "10 saves the contact")
    run(workflow_query("10", "Upsert Lead"),
        [A, contact, "HOT", 85, {"budget": 800000, "area": "Mokotów", "financing": "mortgage approved", "timing": "2 months"}])
    lead = sql(f"select status, score, qualification_answers->>'area' from leads where tenant_id = '{A}' and contact_id = '{contact}'")
    check(lead == [["HOT", "85", "Mokotów"]], f"the lead is hot with its answers: {lead}")
    linked = sql(f"select contact_id from conversations where id = '{conv}'")
    check(linked == [[contact]], "the conversation belongs to Anna")
    found = json.loads(one(workflow_query("01", "Search Listings"),
                           [A, {"transaction_type": "sale", "location": "Mokotów", "max_price": 800000}]))
    refs = [x.get("reference") for x in found.get("listings", [])]
    check(refs == ["A-1"], f"search finds the flat in budget, not the penthouse or another agency's: {refs}")
    one(workflow_query("01", "Log Assistant Message"), [A, conv, "Yes: a 2-room flat on Mokotów for 690,000 zł."])
    history = run(workflow_query("01", "Load Conversation History"), [A, conv])
    check(len(history) == 2, f"history has the question and the answer: {len(history)} rows")
    state.update(conv=conv, contact=contact)


@journey("B  appointment: booked in the agent's calendar, no double booking, reminder sent once")
def scenario_b():
    insert = workflow_query("12", "Insert Appointment")
    p = [A, state["contact"], at(10), at(10, 30), "Europe/Warsaw", "gcal-event-1", "Viewing A-1", L1,
         state["conv"], "", "", "ola@agency-a.pl", "viewing", ""]
    row = run(insert, p)[0]
    appt = row[0]
    check(row[3] == "confirmed" and row[4] == L1 and row[5] == state["conv"], f"12 books it with the listing and chat: {row}")
    # Same calendar, overlapping time: the database refuses.
    clash = fails(insert, [*p[:2], at(10, 15), at(10, 45), "Europe/Warsaw", "gcal-event-2", "x", "", "", "", "", "ola@agency-a.pl", "viewing", ""])
    check("excl_no_overlapping_appointments" in clash, f"a second viewing in the same calendar at the same time is refused: {clash or 'it was accepted'}")
    # Another calendar at the same time is fine (two agents).
    other = run(insert, [*p[:2], at(10, 15), at(10, 45), "Europe/Warsaw", "gcal-event-3", "x", "", "", "", "", "other-agent@agency-a.pl", "viewing", ""])
    check(len(other) == 1, "another agent's calendar can take the same time")
    sql(f"update appointments set status = 'cancelled' where id = '{other[0][0]}'")
    # Reminder the day before: due once, then recorded.
    due = [r for r in run(workflow_query("38", "Viewings Tomorrow")) if appt in r]
    check(len(due) == 1, "38 finds tomorrow's viewing for a reminder")
    run(workflow_query("38", "Record Reminder"), [appt, "email", True, "Reminder sent by email", state["conv"]])
    again = [r for r in run(workflow_query("38", "Viewings Tomorrow")) if appt in r]
    check(again == [], "the reminder is not sent twice")
    state["appt"] = appt


@journey("C  appointment changes: only the client's own viewing; move checks clashes; cancel once")
def scenario_c():
    load = workflow_query("37", "Load Booking")
    mine = run(load, [A, state["contact"], state["appt"], state["conv"]])
    check(len(mine) == 1 and state["appt"] in mine[0], "37 finds the client's own viewing from the same chat")
    stranger = one(workflow_query("10", "Upsert Contact"), [A, "Somebody Else", "else@example.com", "", "", "chat_widget", ""])
    check(run(load, [A, stranger, state["appt"], ""]) == [], "another client cannot load Anna's viewing")
    other_chat = one(workflow_query("01", "Get or Create Conversation"), [A, None])
    check(run(load, [A, state["contact"], state["appt"], other_chat]) == [],
          "on the website chat, a viewing booked in another chat is not shown (identity is only typed in)")
    # A clash with a viewing already in that calendar is refused.
    blocker = run(workflow_query("12", "Insert Appointment"),
                  [A, stranger, at(14), at(14, 30), "Europe/Warsaw", "gcal-event-4", "x", "", "", "", "", "ola@agency-a.pl", "viewing", ""])[0][0]
    move = workflow_query("37", "Move In Dashboard")
    clash = json.loads(one(move, [A, state["contact"], state["appt"], at(14), at(14, 30)]))
    check(clash.get("ok") is not True and clash.get("success") is not True, f"moving onto another viewing is refused: {clash}")
    moved = json.loads(one(move, [A, state["contact"], state["appt"], at(16), at(16, 30)]))
    check(moved.get("ok") is True or moved.get("success") is True, f"moving to a free time works: {moved}")
    starts = sql(f"select starts_at = '{at(16)}'::timestamptz from appointments where id = '{state['appt']}'")
    check(starts == [["t"]], "the viewing is now at 16:00")
    cancel = workflow_query("37", "Mark Cancelled")
    check(one(cancel, [A, state["contact"], state["appt"]]) == "t", "the client cancels it")
    check(one(cancel, [A, state["contact"], state["appt"]]) == "f", "cancelling again changes nothing")
    sql(f"update appointments set status = 'cancelled' where id = '{blocker}'")


@journey("D  seller enquiry: valuation request becomes a hot seller lead with the property details")
def scenario_d():
    conv = one(workflow_query("01", "Get or Create Conversation"), [A, None])
    seller = one(workflow_query("10", "Upsert Contact"), [A, "Marek Seller", "marek.journey@example.com", "+48 600 300 400", "", "chat_widget", conv])
    r = json.loads(one(workflow_query("01", "Record Valuation Request"),
                       [A, seller, {"address": "ul. Puławska 10/5", "city": "Warszawa", "area_m2": 54, "rooms": 3, "within_3_months": True}]))
    check(r.get("intent") == "sell" and r.get("status") == "HOT", f"a seller within 3 months is a hot sell lead: {r}")
    lead = sql(f"select intent, qualification_answers->'valuation'->>'address' from leads where id = '{r['lead_id']}'")
    check(lead == [["sell", "ul. Puławska 10/5"]], f"the property details are on the lead: {lead}")
    visit = run(workflow_query("12", "Insert Appointment"),
                [A, seller, at(12), at(13), "Europe/Warsaw", "gcal-event-5", "Valuation", "", conv, "", "", "ola@agency-a.pl", "valuation", "ul. Puławska 10/5"])
    kind = sql(f"select kind, location from appointments where id = '{visit[0][0]}'")
    check(kind == [["valuation", "ul. Puławska 10/5"]], f"12 books the valuation visit at the property: {kind}")


@journey("E  human takeover: escalation for the team, an agent takes over, Elliot stands back")
def scenario_e():
    conv = state["conv"]
    esc = run(workflow_query("24", "Insert Escalation"), [A, conv, "customer_requested_human", "high", "Anna wants to negotiate the price."])[0]
    check(len(esc[0]) == 36, "24 opens an escalation")
    check(sql(f"select status, priority from escalations where id = '{esc[0]}'") == [["open", "high"]], "it is open and high priority")
    # Ola (an agent at agency A) takes over from the dashboard.
    run("select take_over_conversation($1::uuid)", [conv], as_user=AGENT_A)
    r = json.loads(one(workflow_query("01", "Log User Message"), [A, conv, "Can we talk about the price?"]))
    check(r.get("human_takeover") is True, f"01 sees that a person has taken over and does not answer: {r}")
    # Piotr at agency B cannot take over agency A's conversation.
    err = fails("select take_over_conversation($1::uuid)", [conv], as_user=AGENT_B)
    still = sql(f"select c.assigned_human = u.id from conversations c, tenant_users u where c.id = '{conv}' and u.auth_user_id = '{AGENT_A}'")
    check(still == [["t"]], f"another agency's agent cannot take it over ({err or 'no error, but nothing changed'})")


@journey("F  follow-up: a due step is handed out once; STOP ends the sequence")
def scenario_f():
    contact = one(workflow_query("10", "Upsert Contact"), [A, "Quiet Lead", "quiet.journey@example.com", "", "", "email", ""])
    run(workflow_query("10", "Upsert Lead"), [A, contact, "WARM", 55, {}])
    seq = str(uuid.uuid4())
    sql(f"""insert into follow_up_sequences (id, tenant_id, name, steps) values ('{seq}', '{A}', 'Journey',
         '[{{"day_offset": 0, "channel": "email", "subject": "Still looking?", "body": "Hi {{{{contact_name}}}}"}},
           {{"day_offset": 3, "channel": "email", "subject": "One more", "body": "Hi again"}}]') returning id""")
    sql(f"""insert into follow_up_runs (tenant_id, lead_id, sequence_id, status, next_run_at)
            select '{A}', id, '{seq}', 'running', now() - interval '1 minute' from leads where contact_id = '{contact}' returning id""")
    due = workflow_query("20", "Query Due Runs")
    first = [r for r in run(due) if contact in r]
    check(len(first) == 1, "20 hands out the due step")
    check([r for r in run(due) if contact in r] == [], "running the sweep again hands out nothing (no duplicate)")
    # The client answers STOP by email: the sequence ends.
    conv = one(workflow_query("01", "Get or Create Conversation"), [A, None])
    sql(f"update conversations set contact_id = '{contact}', channel = 'email' where id = '{conv}' returning id")
    one(workflow_query("01", "Log User Message"), [A, conv, "STOP"])
    run_state = sql(f"select r.status, r.stop_reason from follow_up_runs r join leads l on l.id = r.lead_id where l.contact_id = '{contact}'")
    check(run_state == [["stopped", "opted_out"]], f"STOP ends the follow-ups: {run_state}")


@journey("G  two agencies: neither sees nor changes the other's data")
def scenario_g():
    # n8n side: agency B can't continue agency A's conversation.
    conv_b = one(workflow_query("01", "Get or Create Conversation"), [B, state["conv"]])
    check(conv_b != state["conv"], "agency B gets its own new conversation, not agency A's")
    found = json.loads(one(workflow_query("01", "Search Listings"), [B, {"location": "Mokotów"}]))
    check([x.get("reference") for x in found.get("listings", [])] == ["B-1"], "agency B's search only finds agency B's listings")
    check(run(workflow_query("37", "Load Booking"), [B, state["contact"], state["appt"], ""]) == [], "agency B can't load agency A's viewing")
    # Dashboard side: Piotr (agency B) sees none of agency A's records.
    for table in ("contacts", "leads", "conversations", "messages", "appointments", "escalations", "listings"):
        n = one(f"select count(*) from {table} where tenant_id = $1::uuid", [A], as_user=AGENT_B)
        check(n == "0", f"an agency B agent sees {n} of agency A's {table}")
    n = one("select count(*) from contacts where tenant_id = $1::uuid", [A], as_user=AGENT_A)
    check(int(n) >= 4, "an agency A agent does see agency A's contacts (the check above is not empty by accident)")


print(f"  ok   {passed} journey checks passed")
