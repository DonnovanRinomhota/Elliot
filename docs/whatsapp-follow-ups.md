# WhatsApp follow-ups (0045)

Any step of a follow-up sequence can be sent by WhatsApp instead of email: in **Follow-ups → Edit**, switch the step to **WhatsApp**.

## Who gets what

| The client… | A WhatsApp step | An email step |
| --- | --- | --- |
| has written to the agency on WhatsApp | WhatsApp | email (WhatsApp if they have no email address) |
| has never written on WhatsApp | email | email |
| has no email and never wrote on WhatsApp | skipped | skipped |

WhatsApp only goes to clients who have messaged the agency's WhatsApp number themselves. That is their opt-in, which WhatsApp requires before a business may message someone. Leads reachable only on WhatsApp are now auto-enrolled into sequences too.

## How a WhatsApp step is sent

- **Within 24 hours** of the client's last WhatsApp message: as written, line breaks and all.
- **After 24 hours**, WhatsApp only allows approved templates, so Elliot sends it inside the **elliot_follow_up** template: *"Message from [agency]:"*, the step's text on one line, then *"Reply to this message to continue."* The language (English or Polish) is picked from the text.
- A WhatsApp step can be up to 900 characters, WhatsApp's own limit for a template message less the template's fixed words.
- The approval setting (Settings → What Elliot may do on its own → Send follow-up sequences) applies as for email: each step waits in Approvals, or goes automatically.
- If WhatsApp refuses a message (for example the template isn't approved yet), it shows in **Approvals → Blocked on WhatsApp** with WhatsApp's reason, and the sequence moves on.

## Set up (once)

1. **Supabase → SQL Editor**: run `db/migrations/0045_whatsapp_follow_ups.sql`.
2. **n8n**: re-import `20-follow-up-sweep.json` and `27-send-approved-whatsapp.json` (open each existing workflow → ⋯ → Import from File, or delete and import; keep the same workflow so its ID stays).
   - In 27, open **Send Follow-Up Template** → Credential → **WhatsApp Cloud API token**. Check the Postgres nodes show **Elliot Postgres (service role)**.
   - In 20, open **Send WhatsApp**: it should show **27 - Send Approved WhatsApp**. If it shows an error, choose 27 from the list (by ID it is the same workflow 26 and 28 call).
   - Save both. 20 stays **Active**.
3. **WhatsApp Manager → Message templates → Create template**, twice (one per language):

   | | English | Polish |
   | --- | --- | --- |
   | Category | Marketing | Marketing |
   | Name | `elliot_follow_up` | `elliot_follow_up` |
   | Language | English | Polish |
   | Body | `Message from {{1}}:` *(blank line)* `{{2}}` *(blank line)* `Reply to this message to continue.` | `Wiadomość od {{1}}:` *(blank line)* `{{2}}` *(blank line)* `Odpowiedz na tę wiadomość, aby kontynuować.` |
   | Sample for {{1}} | `Simon Real Estate` | `Simon Real Estate` |
   | Sample for {{2}} | `Hi Anna, two new flats came in that match what you asked for. Shall I send the details?` | `Dzień dobry, mamy dwa nowe mieszkania, które pasują do Pani wymagań. Czy przesłać szczegóły?` |

   Meta may move it to a different category; accept what it suggests. Approval usually takes minutes to a day. Until it's approved, WhatsApp steps after 24 hours show as blocked in Approvals; steps within 24 hours work straight away.

Marketing template messages are charged by Meta per message delivered; see WhatsApp Manager → Insights for the rates in Poland.
