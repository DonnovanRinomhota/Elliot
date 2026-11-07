import { notFound } from "next/navigation";
import { ExternalLink, MapPin, Phone, Mail, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { listingPhotos } from "@/lib/listing-photos";
import { formatPrice } from "@/lib/listings";
import {
  APPOINTMENT_SELECT,
  DEFAULT_TZ,
  dayKey,
  dayLabel,
  listingAddress,
  mapsUrl,
  timeRange,
  type Appointment,
  type TeamMember,
} from "@/lib/appointments";
import { PageHeader, Panel, StatusBadge, btn } from "../../../../_ui/ui";
import AppointmentActions from "../appointment-actions";
import AgentPicker from "./agent-picker";
import ChangeListing from "./change-listing";
import ListingPicker from "./listing-picker";
import PhotoGallery from "./photo-gallery";

// Everything an agent needs before a viewing: the property (photos, address,
// map, key facts), when, who the client is, and who's going.
export default async function AppointmentPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", params.id).maybeSingle();
  if (error || !data) notFound();
  const a = data as unknown as Appointment;

  const [{ data: team }, { data: conversation }] = await Promise.all([
    supabase.from("tenant_users").select("id, full_name, email, role").is("removed_at", null).in("role", ["admin", "agent"]).order("full_name"),
    a.contact?.id
      ? supabase.from("conversations").select("id").eq("contact_id", a.contact.id).order("updated_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tz = a.timezone || DEFAULT_TZ;
  const day = dayKey(a.starts_at, tz);
  const client = contactLabel(a.contact);
  const l = a.listing;
  const photos = l ? listingPhotos(l) : [];
  const address = listingAddress(l);
  const facts = l
    ? [
        formatPrice(l.price, l.currency, l.transaction_type),
        l.area_m2 ? `${Number(l.area_m2)} m²` : null,
        l.rooms ? `${l.rooms} room${l.rooms === 1 ? "" : "s"}` : null,
        l.floor != null ? `floor ${l.floor}` : null,
      ].filter(Boolean)
    : [];

  const row = "flex items-start gap-2.5 text-[13.5px]";
  const icon = { size: 15, strokeWidth: 1.75, className: "mt-0.5 flex-shrink-0 text-gray-400", "aria-hidden": true } as const;

  return (
    <div>
      <a href="/dashboard/appointments" className="text-[13px] text-gray-500 no-underline hover:text-ink">
        Appointments
      </a>
      <PageHeader
        title={`Viewing with ${client}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-ink">
              {dayLabel(day, "long")}, <span className="tabular">{timeRange(a, tz)}</span>
              {tz !== DEFAULT_TZ ? ` (${tz})` : ""}
            </span>
            <StatusBadge kind="appointment" value={a.status} />
          </span>
        }
        actions={<AppointmentActions id={a.id} status={a.status} startsAt={a.starts_at} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <div className="grid content-start gap-6">
          {l ? (
            <Panel title="The property" action={<ChangeListing appointmentId={a.id} currentId={l.id} />}>
              {photos.length > 0 ? (
                <PhotoGallery photos={photos} title={l.title} />
              ) : (
                <p className="m-0 rounded-md bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500">
                  No photos on this listing yet.{" "}
                  <a href={`/dashboard/listings/${l.id}`} className="text-ink underline">
                    Add photos
                  </a>
                </p>
              )}
              <div className="mt-4 grid gap-3">
                <div>
                  <h3 className="m-0 text-[17px] font-semibold text-ink">{l.title}</h3>
                  <p className="m-0 mt-0.5 text-[13px] text-gray-500">
                    {[l.reference && `Ref ${l.reference}`, ...facts].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {address ? (
                  <div className={row}>
                    <MapPin {...icon} />
                    <div>
                      <div className="text-ink">{address}</div>
                      <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="text-[13px] text-ink-600 underline">
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="m-0 text-[13px] text-brass-dark">
                    This listing has no address.{" "}
                    <a href={`/dashboard/listings/${l.id}`} className="underline">
                      Add it to the listing
                    </a>{" "}
                    so it shows here and on the map.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <a href={`/dashboard/listings/${l.id}`} className={`${btn.secondary} ${btn.small}`}>
                    Open listing
                  </a>
                  {l.url && (
                    <a href={l.url} target="_blank" rel="noreferrer" className={`${btn.ghost} ${btn.small}`}>
                      Listing page <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Which property is this viewing for?">
              <p className="mb-3 mt-0 text-[13px] text-gray-600">
                Elliot didn&apos;t record a listing for this booking
                {a.notes ? (
                  <>
                    . Its note says: <span className="text-ink">&ldquo;{a.notes}&rdquo;</span>
                  </>
                ) : null}
                . Pick the listing, so the photos and address show here for the agent.
              </p>
              <ListingPicker appointmentId={a.id} currentId={null} />
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Client">
            <div className="grid gap-2.5">
              <div className="text-[15px] font-medium text-ink">{client}</div>
              {a.contact?.phone && (
                <a href={`tel:${a.contact.phone.replace(/\s+/g, "")}`} className={`${row} text-ink no-underline hover:underline`}>
                  <Phone {...icon} />
                  <span className="tabular">{a.contact.phone}</span>
                </a>
              )}
              {a.contact?.email && (
                <a href={`mailto:${a.contact.email}`} className={`${row} min-w-0 text-ink no-underline hover:underline`}>
                  <Mail {...icon} />
                  <span className="truncate">{a.contact.email}</span>
                </a>
              )}
              {conversation && (
                <a href={`/dashboard/conversations/${(conversation as { id: string }).id}`} className={`${row} text-ink-600 underline`}>
                  <MessageCircle {...icon} />
                  Read the conversation with Elliot
                </a>
              )}
            </div>
          </Panel>

          <Panel title="Agent">
            <AgentPicker appointmentId={a.id} agentId={a.agent_id} team={(team ?? []) as TeamMember[]} />
          </Panel>

          <Panel title="Notes from the booking">
            <p className="m-0 whitespace-pre-wrap text-[13.5px] text-gray-700">{a.notes || <span className="text-gray-400">No notes.</span>}</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
