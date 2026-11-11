# Email attachments (0046)

Files clients attach to their emails are kept, shown to the team, and read by Elliot.

## What happens

- Workflows **16** (the agency's Gmail) and **40** (emails forwarded to `<slug>@in.getelliot.eu`) save each attachment in Supabase Storage, in the private **email-attachments** bucket, under `<agency id>/<conversation id>/`.
- **Elliot reads PDFs and photos** (JPEG, PNG, GIF, WebP): up to 5 per email, photos up to 5 MB and PDFs up to 10 MB. Claude opens each one through a link that works for an hour. Elliot uses what is in them (a mortgage pre-approval, a floor plan, a photo of a flat they liked) and never repeats ID, passport, PESEL or bank account numbers.
- **Other files** (Word, Excel, iPhone HEIC photos, larger files) are kept for the team; Elliot tells the client the team will look at them.
- Up to 10 files per email, 25 MB each. Small images (email signature logos) are skipped.
- An email with only attachments and no text is answered too.
- **On the conversation page** each file appears under the client's message, with Open and Download. A file that couldn't be saved is shown in red. Files are only reachable through the dashboard, which checks the agency may see them; links last one minute.
- If saving fails (Storage down, wrong key), the email is still answered; Elliot just doesn't get the files.

## Set up (once)

1. **Supabase → SQL Editor**: run `db/migrations/0046_email_attachments.sql`. Then, with your project URL (Project Settings → Data API → Project URL):
   ```sql
   update platform_settings set supabase_url = 'https://YOUR-PROJECT-REF.supabase.co';
   ```
2. **n8n → Credentials → Add credential → Custom Auth**, name it **Supabase Storage (service role)**, and paste (with the **service_role** key from Supabase → Project Settings → API Keys → *Legacy API keys* tab → service_role → Reveal; the same key in both places):
   ```json
   { "headers": { "apikey": "SERVICE_ROLE_KEY", "Authorization": "Bearer SERVICE_ROLE_KEY" } }
   ```
3. **n8n**: re-import into the existing workflows (⋯ → Import from File, so their IDs stay):
   - `01-main-ai-agent.json`
   - `16-email-inbound-trigger.json`: open **Upload Attachment** and **Sign Attachment** → Credential → *Supabase Storage (service role)*. Check **Gmail Trigger** still shows your Gmail account.
   - `40-email-inbound-forwarded.json`: the same two nodes → *Supabase Storage (service role)*; **List Attachments** and **Fetch Email** → *Resend API key*.
   - Check the Postgres nodes show *Elliot Postgres (service role)*, and the **Build Elliot Request** nodes still have the chat webhook address if you had pasted one. Save all three.

## Cost

Claude charges for what it reads: roughly 1,500–3,000 tokens per PDF page and about 1,500 per photo, once per reply (re-reads within the same reply are cached at a tenth of the price). A 3-page PDF and two photos add about 1–2 US cents to that reply.

## Privacy

Clients send ID scans, payslips and bank letters. The bucket is private, each agency sees only its own files, and Elliot is told not to repeat identity or bank numbers. Files stay until deleted; deleting an agency removes its rows but not the files in Storage (delete its folder in Supabase → Storage → email-attachments).
