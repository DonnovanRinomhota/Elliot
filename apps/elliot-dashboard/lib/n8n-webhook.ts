/**
 * SERVER-ONLY helper for calling Elliot's internal n8n webhooks
 * (19 onboarding, 30 cancel appointment, ...). Never import this from a
 * "use client" component -- same rule as lib/supabase/admin.ts.
 *
 * Those webhooks now require an `x-elliot-webhook-secret` header matching the
 * n8n instance's ELLIOT_WEBHOOK_SECRET. The secret must never reach the
 * browser, so these calls go through Next.js route handlers, never straight
 * from a client component.
 *
 * Env (server-only, no NEXT_PUBLIC_ prefix), set in Vercel for Production,
 * Preview and Development:
 *   ELLIOT_WEBHOOK_SECRET   same value as on the n8n instance (16+ chars)
 *   N8N_<NAME>_WEBHOOK_URL  the workflow's Production webhook URL
 */

export type WebhookResult =
  | { ok: true; status: number; data: any }
  | { ok: false; status: number; error: string };

export function webhookConfigured(urlEnvName: string): boolean {
  return !!process.env[urlEnvName] && !!process.env.ELLIOT_WEBHOOK_SECRET;
}

export async function callInternalWebhook(urlEnvName: string, body: unknown): Promise<WebhookResult> {
  const url = process.env[urlEnvName];
  const secret = process.env.ELLIOT_WEBHOOK_SECRET;
  if (!url) return { ok: false, status: 500, error: `${urlEnvName} is not set on the dashboard.` };
  if (!secret) return { ok: false, status: 500, error: "ELLIOT_WEBHOOK_SECRET is not set on the dashboard." };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-elliot-webhook-secret": secret },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Couldn't reach n8n: ${(e as Error).message}` };
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // n8n returns plain text / HTML for some failures (e.g. workflow inactive).
  }

  if (res.status === 401) {
    return { ok: false, status: 502, error: "n8n rejected the webhook secret. Check ELLIOT_WEBHOOK_SECRET matches on both sides." };
  }
  if (!res.ok || !data || data.success === false) {
    const msg = data?.error || data?.message || text.slice(0, 200) || `n8n returned HTTP ${res.status}`;
    return { ok: false, status: res.status >= 400 ? res.status : 502, error: msg };
  }
  return { ok: true, status: res.status, data };
}
