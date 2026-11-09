# WhatsApp setup and end-to-end test

How to switch WhatsApp on for an agency and check it works. About an hour
the first time, most of it on Meta's side.

What you get: a client writes to the agency's WhatsApp number, Elliot
answers within seconds (listings, viewings booked with the property, lead
capture), the chat appears in the dashboard under Conversations, and a team
member can take it over and reply from the dashboard.

Start with Meta's free **test number**. It can only message up to 5 phone
numbers you add yourself, which is exactly what you need for testing. Move
to the agency's real number when everything works (step 7).

## 1. Database (Supabase)

Run `db/migrations/0032_whatsapp_instant_replies.sql` in the SQL editor
(after 0028–0031 if those aren't run yet). Safe to run twice.

## 2. Meta: app, test number and token

1. Go to developers.facebook.com → **My Apps** → **Create app**. Choose the
   WhatsApp / "Connect with customers through WhatsApp" use case (type
   *Business*) and link your Meta Business portfolio (create one if asked).
2. In the app: **WhatsApp → API Setup**. Note:
   - the **Phone number ID** of the test number (a long number, not the
     phone number itself);
   - under **To**, add your own mobile number and confirm the code Meta
     sends. Add any other phones you'll test with (up to 5).
3. **Permanent token** (the one on API Setup expires after 24 hours):
   business.facebook.com → **Settings → Users → System users** → **Add**
   (role Admin) → **Assign assets**: your app (full control) and your
   WhatsApp account (full control) → **Generate token** for your app, expiry
   **Never**, permissions `whatsapp_business_messaging` and
   `whatsapp_business_management`. Copy it somewhere safe; Meta shows it
   once.
4. **App Secret**: in the app, **App settings → Basic → App secret → Show**.
5. Make up a **verify token**: any long random string, e.g. from
   `openssl rand -hex 16`. You'll paste it in two places.

## 3. n8n

1. **Credential**: Credentials → **Add** → *Header Auth*. Name it exactly
   `WhatsApp Cloud API token`. Name: `Authorization`. Value:
   `Bearer ` followed by the token from 2.3 (with the space).
2. **Workflow 01** (Elliot): import the new `01-main-ai-agent.json` over
   the old one, as before. Check the credentials and the Execute Workflow
   nodes still point at your workflows, Save, keep it **Active**.
3. **Workflow 25** (WhatsApp in): import `25-whatsapp-inbound-trigger.json`
   and delete the old 25 (both use the `whatsapp` path; only one can be
   active). Then:
   - **Check Verify Token**: replace `PASTE_WHATSAPP_VERIFY_TOKEN_HERE`
     with your verify token (2.5).
   - **Verify Meta Signature**: replace `PASTE_META_APP_SECRET_HERE` with
     the App Secret (2.4).
   - **Build Elliot Request**: leave as it is. It finds Elliot at
     `https://<you>.app.n8n.cloud/webhook/chat` by itself.
   - Postgres nodes → *Elliot Postgres (service role)*; *Send WhatsApp
     Reply* → *WhatsApp Cloud API token*.
   - Save, **Activate**.
4. **Workflow 32** (team replies): import `32-send-whatsapp-message.json`.
   Trigger → *Elliot Internal Webhook Secret*; *Load Conversation* →
   service role; *Send via WhatsApp API* → *WhatsApp Cloud API token*.
   Save, **Activate**, and copy the trigger's **Production URL**.
5. Workflow 26 (old WhatsApp drafts) is no longer used; you can deactivate
   it. Keep 27 and 28 active if Approvals still has WhatsApp drafts.

Never export 25 back into GitHub with the real secrets in it.

## 4. Meta: point WhatsApp at n8n

In the app: **WhatsApp → Configuration → Webhook → Edit**.
- Callback URL: `https://<you>.app.n8n.cloud/webhook/whatsapp`
- Verify token: the one from 2.5
- **Verify and save**. (Workflow 25 must be active. If it fails, the token
  in *Check Verify Token* doesn't match.)

Then under **Webhook fields**, **Subscribe** to `messages`.

## 5. Dashboard

1. Vercel → elliot-real-estate → Settings → Environment Variables: add
   `N8N_SEND_WHATSAPP_MESSAGE_WEBHOOK_URL` = workflow 32's Production URL
   (Production, Preview, Development). `ELLIOT_WEBHOOK_SECRET` is already
   there. Redeploy.
2. In the dashboard, as the agency: **Settings → Connected services →
   WhatsApp phone number ID** = the Phone number ID from 2.2. Save.

## 6. End-to-end test

From one of the phones you added in 2.2, message the test number:

| # | Send | Expect |
|---|---|---|
| 1 | `Hi` | A reply within about 10 seconds. If WhatsApp gave no name, Elliot asks for it. Dashboard → Conversations: a new **WhatsApp** conversation with both messages. |
| 2 | Your name | Elliot uses it. The contact panel shows the name and your number. |
| 3 | `Do you have a 2-room flat to rent in <area> under <price>?` | Real listings from Listings, short, with links. |
| 4 | `Can I see the first one on Thursday?` then pick one of the times | Viewing booked. Appointments shows it with the property, photos and address; the Google Calendar event too. |
| 5 | A photo | Elliot says it can't open photos and asks you to type. |
| 6 | Dashboard: **Take over this chat**, reply `Test from the office` | Arrives on your phone. Your next message gets no reply from Elliot. |
| 7 | **Hand back to Elliot**, then message again | Elliot answers again. |
| 8 | `I want to speak to a person` | Elliot hands over; an escalation appears in Escalations. |

Leads should show you as a lead after steps 3–4.

## 7. The agency's real number (when testing passes)

In WhatsApp Manager add the agency's number (it can't be in use on the
WhatsApp app at the same time), get the display name approved, complete
Business Verification, and add a payment method. Then put the new number's
**Phone number ID** in that agency's Settings. Nothing changes in n8n: one
token and one webhook serve every agency's number.

## If something doesn't work

Open n8n → workflow 25 → Executions and find where it stopped.

| Where it stops | Meaning | Fix |
|---|---|---|
| No execution at all | Meta isn't calling n8n | Step 4: callback URL, `messages` subscribed, 25 active. |
| *Signature Valid?* false | `_signature` on *Verify Meta Signature* says why | `no_secret_configured`: paste the App Secret. `invalid`: wrong App Secret. |
| *If Tenant Found* false | The number isn't linked to an agency | Settings → WhatsApp phone number ID (the ID, not the phone number). |
| *Ask Elliot* status not 200 | Elliot (01) failed or isn't active | Open 01's execution for the error. |
| *Check Send Result* `ok: false` | Meta refused the reply; the conversation shows a note | `190`: token expired or wrong (step 3.1). `131030`: add the phone in API Setup → To (test number only). `131047`: client last wrote more than 24 hours ago. |

Team reply fails in the dashboard: the reason shows under the reply box.
"N8N_SEND_WHATSAPP_MESSAGE_WEBHOOK_URL is not set": step 5.1.

WhatsApp only allows free-form messages within 24 hours of the client's
last message. After that the dashboard disables the reply box until the
client writes again. (Sending outside the window needs Meta-approved
templates, which aren't built yet.)
