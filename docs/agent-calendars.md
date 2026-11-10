# Agents' own calendars (0042, workflow 41)

Each agent can connect their own Google Calendar by sharing it with Elliot's
Google account (the one in n8n's "Elliot Google Calendar" credential). No
Google app review is needed.

- **Free times (11):** a time is offered when at least one agent with a
  calendar is free (with the travel buffer from Settings → Viewings).
- **Booking (12):** right before booking, Elliot checks those calendars again
  and puts the viewing in a free agent's calendar: the client's own agent
  (owner of their lead) first, then whoever has the fewest upcoming viewings.
  The client's confirmation names that agent.
- **No double booking** is now per calendar: two agents can have viewings at
  the same time; one agent can't have two.
- **No agent calendars:** nothing changes, the agency calendar (Settings) is
  used, one viewing at a time.
- **Team page → Calendars:** each person pastes their Calendar ID (usually
  their email) and Saves; Elliot checks it straight away (workflow 41) and
  shows Connected / Can't add viewings / Not shared with Elliot.

## Set-up

1. **Supabase → SQL Editor:** run `db/migrations/0042_agent_calendars.sql`.
2. **n8n:**
   - Re-import **11**, **12** and **30** (replace). Check credentials as usual
     (Postgres, Google Calendar "Elliot Google Calendar"). In 12, "Send
     Confirmation Email" already points at 39. Publish.
   - Import **41 - Calendar Access Check**. Credentials:
     - *Calendar Check Webhook*: Header Auth **Elliot Internal Webhook Secret**
     - *Calendars To Check*, *Save Results*: **Elliot Postgres (service role)**
     - the three Google nodes: **Elliot Google Calendar**

     Publish, then copy the webhook's **Production URL**.
3. **Vercel → elliot-real-estate → Settings → Environment Variables:** add
   `N8N_CALENDAR_CHECK_WEBHOOK_URL` = that URL (Production, Preview,
   Development), then redeploy.
4. **Dashboard → Team → Check calendars** once: it fills in Elliot's Google
   address in the sharing steps.

## Test

1. In Google Calendar (as an agent), share the calendar with Elliot's address
   with **Make changes to events**. Paste its ID on the Team page, Save: it
   shows **Connected**.
2. Do the same for a second agent.
3. Put a busy event in agent A's calendar at 10:00 tomorrow. In the website
   chat, ask for a viewing tomorrow at 10:00: Elliot offers it and books it
   into agent B's calendar.

## Limits

- Changing the agent on an appointment in the dashboard doesn't move the
  Google event; move it in Google Calendar.
- A client moving a viewing keeps the same agent (and calendar).
- Google calendars only; Outlook calendars aren't supported yet.
