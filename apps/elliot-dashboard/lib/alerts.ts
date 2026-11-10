// Problem alerts (migration 0036, workflow 33): checking what people type
// into the alert settings, for both the agency's Settings page and the
// Control panel. Shared so both validate the same way.

export type AlertChannelInput = {
  email_enabled: boolean;
  email: string;
  whatsapp_enabled: boolean;
  whatsapp: string;
};

export type AlertChannelValue = {
  email_enabled: boolean;
  email: string | null;
  whatsapp_enabled: boolean;
  whatsapp: string | null;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** International number as WhatsApp wants it: digits only, country code first. */
export function whatsappDigits(input: string): string {
  return String(input || "").replace(/\D/g, "");
}

/** Shows a stored number back in a readable way: +48 600 100 200. */
export function formatWhatsapp(digits: string | null | undefined): string {
  const d = whatsappDigits(digits || "");
  if (!d) return "";
  // Polish numbers (48 + 9 digits) are grouped the usual way; anything else is
  // shown as typed digits, since grouping differs by country.
  if (/^48\d{9}$/.test(d)) return "+" + d.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");
  return "+" + d;
}

/** Returns the cleaned settings, or an error a person can act on. */
export function checkAlertChannels(v: AlertChannelInput): { ok: true; value: AlertChannelValue } | { ok: false; error: string } {
  const email = String(v.email || "").trim();
  const raw = String(v.whatsapp || "").trim();
  const digits = whatsappDigits(raw);

  if (email && !EMAIL.test(email)) return { ok: false, error: "The alert email address doesn't look right." };
  if (v.email_enabled && !email) return { ok: false, error: "Add an email address, or switch email alerts off." };

  if (raw && raw.startsWith("0")) {
    return { ok: false, error: "Start the WhatsApp number with the country code, e.g. +48 600 100 200." };
  }
  if (raw && (digits.length < 8 || digits.length > 15)) {
    return { ok: false, error: "The WhatsApp number should be 8 to 15 digits including the country code, e.g. +48 600 100 200." };
  }
  if (v.whatsapp_enabled && !digits) return { ok: false, error: "Add a WhatsApp number, or switch WhatsApp alerts off." };

  return {
    ok: true,
    value: {
      email_enabled: !!v.email_enabled,
      email: email || null,
      whatsapp_enabled: !!v.whatsapp_enabled,
      whatsapp: digits || null,
    },
  };
}

export type HealthCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string | null;
  failing_since: string | null;
  checked_at: string;
};

/** The headline for the Control panel's status box. */
export function healthHeadline(status: string | null | undefined, checks: HealthCheck[]): { tone: "ok" | "bad" | "unknown"; text: string } {
  if (!checks.length || status === "unknown") {
    return { tone: "unknown", text: "No checks yet. Import and publish workflow 33; it runs every 15 minutes." };
  }
  const failing = checks.filter((c) => !c.ok);
  if (failing.length) {
    return { tone: "bad", text: `${failing.length} of ${checks.length} checks failing: ${failing.map((c) => c.label).join(", ")}` };
  }
  if (status === "stale") {
    return { tone: "bad", text: "The last check is more than 45 minutes old. Is workflow 33 still published in n8n?" };
  }
  return { tone: "ok", text: `All ${checks.length} checks passing` };
}
