"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cleanEmail, cleanPhone, isIdentified } from "@/lib/contacts";
import { Panel, btn } from "../../../../_ui/ui";

type Contact = { id: string; name: string | null; email: string | null; phone: string | null } | null;

const MISSING_HINT: Record<string, string> = {
  chat_widget: "Website chats now ask for a name and an email or phone before Elliot answers. Older chats may not have them.",
  whatsapp: "WhatsApp gives us the phone number. If there's no name, Elliot's drafted reply asks for it; add it here once you know it.",
  email: "Email gives us the address. If there's no name, Elliot's drafted reply asks for it; add it here once you know it.",
};

// The person in this conversation. The team can fill in or correct their
// details; a conversation with nobody attached gets a new contact.
export default function ContactPanel({
  tenantId,
  conversationId,
  channel,
  contact,
  facts,
}: {
  tenantId: string | null;
  conversationId: string;
  channel: string;
  contact: Contact;
  facts: [string, string][];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: contact?.name ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const name = f.name.trim() || null;
    const email = cleanEmail(f.email);
    const phone = cleanPhone(f.phone);
    if (email === "invalid") return setError("That email address doesn't look right.");
    if (phone === "invalid") return setError("That phone number is too short.");
    if (!name && !email && !phone) return setError("Enter at least a name, email or phone.");

    setBusy(true);
    let e: { code?: string; message: string } | null = null;
    if (contact) {
      ({ error: e } = await supabase.from("contacts").update({ name, email, phone }).eq("id", contact.id));
    } else if (tenantId) {
      const id = crypto.randomUUID();
      ({ error: e } = await supabase.from("contacts").insert({ id, tenant_id: tenantId, name, email, phone, source: channel }));
      if (!e) ({ error: e } = await supabase.from("conversations").update({ contact_id: id }).eq("id", conversationId));
    }
    setBusy(false);
    if (e) {
      setError(e.code === "23505" ? "Another contact in your agency already has this email or phone." : e.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const field = (k: "name" | "email" | "phone", label: string, type = "text") => (
    <div>
      <label htmlFor={`c-${k}`} className="mb-1 block text-[12.5px] font-medium text-gray-600">
        {label}
      </label>
      <input
        id={`c-${k}`}
        type={type}
        value={f[k]}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
        className="h-9 w-full px-3"
        autoComplete="off"
      />
    </div>
  );

  return (
    <Panel
      title="Contact"
      action={
        !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`${btn.ghost} ${btn.small}`}>
            {contact ? "Edit" : "Add details"}
          </button>
        )
      }
    >
      {editing ? (
        <div className="grid gap-3">
          {field("name", "Name")}
          {field("email", "Email", "email")}
          {field("phone", "Phone", "tel")}
          {error && (
            <p className="m-0 text-[13px] text-alert" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className={`${btn.primary} ${btn.small}`}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setF({ name: contact?.name ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "" });
              }}
              className={`${btn.ghost} ${btn.small}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="m-0 grid gap-3 text-[13px]">
          {(
            [
              ["Name", contact?.name],
              ["Email", contact?.email ? <a href={`mailto:${contact.email}`} className="text-ink">{contact.email}</a> : null],
              ["Phone", contact?.phone ? <a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className="text-ink">{contact.phone}</a> : null],
              ...facts,
            ] as [string, React.ReactNode][]
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-gray-500">{label}</dt>
              <dd className="m-0 break-words text-ink">{value || <span className="text-gray-400">Not given</span>}</dd>
            </div>
          ))}
          {!isIdentified(contact) && MISSING_HINT[channel] && (
            <p className="m-0 rounded-md bg-brass-soft px-3 py-2 text-[12.5px] text-brass-dark">{MISSING_HINT[channel]}</p>
          )}
        </dl>
      )}
    </Panel>
  );
}
