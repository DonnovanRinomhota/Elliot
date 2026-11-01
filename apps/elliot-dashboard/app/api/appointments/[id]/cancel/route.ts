// POST /api/appointments/:id/cancel
//
// Cancels an appointment AND removes its Google Calendar event, via n8n
// workflow 30 (the Google credential lives in n8n, not here). Before this,
// the dashboard only flipped appointments.status, leaving the event sitting
// in the tenant's calendar.
//
// Tenant scoping: the appointment is first read through the user's own
// RLS-scoped Supabase session, so a user can only ever cancel their own
// tenant's appointments -- the tenant_id sent to n8n comes from that row, not
// from the request.
//
// If workflow 30 isn't configured yet (N8N_CANCEL_APPOINTMENT_WEBHOOK_URL or
// ELLIOT_WEBHOOK_SECRET unset), it falls back to the old status-only update
// and says so in the response, so cancelling never just stops working.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callInternalWebhook, webhookConfigured } from "@/lib/n8n-webhook";

const WEBHOOK_ENV = "N8N_CANCEL_APPOINTMENT_WEBHOOK_URL";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  }

  const { data: appointment, error: readError } = await supabase
    .from("appointments")
    .select("id, tenant_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ success: false, error: readError.message }, { status: 500 });
  }
  if (!appointment) {
    return NextResponse.json({ success: false, error: "Appointment not found." }, { status: 404 });
  }
  if (["cancelled", "completed", "no_show"].includes(appointment.status)) {
    return NextResponse.json(
      { success: false, error: `This appointment is already ${appointment.status.replace("_", " ")}.` },
      { status: 409 }
    );
  }

  if (!webhookConfigured(WEBHOOK_ENV)) {
    const { error: updateError } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appointment.id);
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, calendar: "not_configured" });
  }

  const result = await callInternalWebhook(WEBHOOK_ENV, {
    appointment_id: appointment.id,
    tenant_id: appointment.tenant_id,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, calendar: result.data.calendar ?? "unknown" });
}
