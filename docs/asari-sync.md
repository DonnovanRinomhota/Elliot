# ASARI CRM sync (0044)

Agencies that keep their listings in ASARI CRM connect it once in **Settings → ASARI CRM**. Elliot then copies the listings they export from ASARI, so it can offer them to clients without anyone typing them in twice.

## How it works

- **Workflow 42 – ASARI Sync** runs every hour and syncs one agency per run (the one synced longest ago). **Sync now** in Settings runs it for that agency straight away, and so does saving new credentials.
- It asks ASARI's site API (`exportedListingIdList`) which listings the agency exports, fetches only the new and changed ones (`/site/listing`), at most 150 a run, one every 2.6 seconds (ASARI allows 25 requests a minute). A first sync of 150 listings takes about 7 minutes; anything above 150 comes in on the next runs.
- Listings are saved with `source = 'asari'`. A listing already typed in Elliot with the same reference number is taken over, not duplicated.
- A listing ASARI no longer exports is marked **withdrawn**, so Elliot stops offering it. If ASARI answers with an error or an empty list, nothing is withdrawn.
- ASARI is the source of truth: edits made in Elliot to an ASARI listing are replaced the next time it changes in ASARI. The listing page says so.
- **Disconnect** removes the credentials. Listings already copied stay and become ordinary listings the agency edits in Elliot.
- The token is stored in `asari_connections`, readable only by the service role (n8n and the dashboard server). Settings never shows it again.
- Each listing keeps ASARI's original data in `listings.external_raw`, so the mapping can be improved without fetching again.

## Set up (once)

1. **Supabase → SQL Editor**: run `db/migrations/0044_asari_sync.sql`.
2. **n8n**: import `n8n/workflows/42-asari-sync.json`.
   - Open **Sync Now Webhook** → Credential → choose **Elliot Internal Webhook Secret**.
   - The three Postgres nodes should already show **Elliot Postgres (service role)**; if not, choose it.
   - Save, then switch the workflow **Active**.
   - Copy the **Production URL** from Sync Now Webhook.
3. **Vercel → elliot dashboard project → Settings → Environment Variables**: add `N8N_ASARI_SYNC_WEBHOOK_URL` = that URL (Production, Preview, Development), then redeploy.

## Connecting an agency

The agency needs ASARI's **site API (apiSite)** credentials: an API user ID and a token. ASARI support issues them if the agency doesn't have them. The agency (or you, while viewing their dashboard) pastes them into Settings → ASARI CRM and presses **Connect ASARI**. Pasting `ID:token` into the first box fills both boxes.

## First real sync: check the mapping

ASARI's listing fields aren't fully documented publicly and vary between accounts, so the mapper (`Map Listings` in workflow 42) looks for each value under the names ASARI is known to use. After the first real sync, open a few ASARI listings in Elliot and check title, price, area, rooms, district, description and photos. If something is missing, look at `external_raw` for that listing in Supabase and adjust `Map Listings`; the next change in ASARI updates the listing.

Photos are linked from `img.asariweb.pl`; if they don't load, the agency may need its photos made public for the website export in ASARI.

## Errors

The Settings card shows the last result. Common ones:

| Shown | Meaning |
| --- | --- |
| ASARI refused the user ID or token | Wrong or revoked credentials, or the site API isn't turned on for the account. |
| ASARI answered HTTP 429 | Too many requests (another tool using the same credentials). The next hourly run retries. |
| *n* couldn't be read | Those listings failed to load or had no title; they're retried when they change in ASARI. |
