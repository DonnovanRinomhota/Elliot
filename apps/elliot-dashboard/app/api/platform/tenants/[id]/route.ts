// PATCH /api/platform/tenants/:id -- control panel: plan, status, dates,
// price, contact, notes. Platform admins only (ADMIN_EMAILS), checked here
// on the server; writes with the service role and records the change.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin, logPlatformEvent } from "@/lib/platform-auth";

const PLANS = ["trial", "starter", "pro", "enterprise", "complimentary"];
const STATUSES = ["active", "suspended", "cancelled"];

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ success: false, error: "Agency name is required." }, { status: 400 });
  if (!PLANS.includes(body.plan)) return NextResponse.json({ success: false, error: "Unknown plan." }, { status: 400 });
  if (!STATUSES.includes(body.status)) return NextResponse.json({ success: false, error: "Unknown status." }, { status: 400 });

  const date = (v: string | undefined) => {
    if (!v) return null;
    const d = new Date(`${v}T23:59:59Z`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const trial = date(body.trial_ends_at);
  const paid = date(body.paid_until);
  if (trial === undefined || paid === undefined) {
    return NextResponse.json({ success: false, error: "A date is not valid." }, { status: 400 });
  }
  let price: number | null = null;
  if (String(body.monthly_price ?? "").trim() !== "") {
    price = Number(String(body.monthly_price).replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ success: false, error: "Monthly price must be a number." }, { status: 400 });
    }
  }
  const email = String(body.contact_email ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ success: false, error: "Contact email doesn't look right." }, { status: 400 });
  }

  const update = {
    name,
    plan: body.plan,
    status: body.status,
    trial_ends_at: trial,
    paid_until: paid,
    monthly_price: price,
    contact_email: email || null,
    notes: String(body.notes ?? "").trim() || null,
  };

  const admin = createAdminClient();
  const { data: before } = await admin.from("tenants").select(Object.keys(update).join(", ")).eq("id", params.id).maybeSingle();
  if (!before) return NextResponse.json({ success: false, error: "Agency not found." }, { status: 404 });

  const { error } = await admin.from("tenants").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Record only what actually changed (notes excluded: private, can be long).
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(update)) {
    const prev = (before as unknown as Record<string, unknown>)[k];
    const same = k.endsWith("_at") || k === "paid_until"
      ? (prev ? String(prev).slice(0, 10) : null) === (v ? String(v).slice(0, 10) : null)
      : String(prev ?? "") === String(v ?? "");
    if (!same && k !== "notes") changes[k] = { from: prev ?? null, to: v };
  }
  if (Object.keys(changes).length) {
    await logPlatformEvent(user.email!, "platform.tenant_updated", params.id, { changes });
  }
  return NextResponse.json({ success: true });
}
