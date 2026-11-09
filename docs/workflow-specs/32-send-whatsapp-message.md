# Workflow Spec: 32 - Send WhatsApp Message

## Trigger
Internal webhook `POST /webhook/send-whatsapp-message`, Header Auth with the
**Elliot Internal Webhook Secret** credential. Called only by the
dashboard's server route `POST /api/conversations/:id/whatsapp`, when a team
member who has taken over a WhatsApp chat presses Send.

The route checks first: signed in, the conversation is their agency's (read
through their own RLS session, which is where `tenant_id` comes from), it's
a WhatsApp conversation, they have taken it over, and the client wrote in
the last 24 hours. Only after this workflow says WhatsApp accepted the
message does the route save it (`send_human_chat_message`), so the
transcript never shows a message the client didn't get.

## Input
```json
{ "tenant_id": "…uuid…", "conversation_id": "…uuid…", "content": "Hi Tomek, …" }
```

## Nodes
| Node | What it does |
|---|---|
| Send WhatsApp Message Webhook | The trigger, with Header Auth. |
| Validate Input | Both ids must be uuids; `content` 1–4096 characters. |
| Load Conversation | The client's phone, the agency's WhatsApp number id and when the client last wrote, only if the conversation is this agency's WhatsApp chat. Always outputs. |
| Check Conversation | 404 not found; 422 no WhatsApp number in Settings, or no phone on the contact; 409 more than 24 hours since the client's last message (WhatsApp's rule; templates aren't built). |
| Can Send? → Respond Error | Refusals go back to the dashboard with the reason, shown under the reply box. |
| Send via WhatsApp API | `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages`, "WhatsApp Cloud API token" credential. |
| Send Result → Respond Result | `{ success: true, wa_message_id }`, or 502 `{ success: false, error: "WhatsApp refused the message: …" }`. |

## Credentials
- Elliot Internal Webhook Secret (Header Auth) on the trigger.
- Elliot Postgres (service role) on *Load Conversation*.
- WhatsApp Cloud API token on *Send via WhatsApp API*.

## Dashboard env (Vercel)
`N8N_SEND_WHATSAPP_MESSAGE_WEBHOOK_URL` = this workflow's Production URL,
plus the existing `ELLIOT_WEBHOOK_SECRET`.
