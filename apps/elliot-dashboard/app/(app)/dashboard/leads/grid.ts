// Column layout shared by the Leads header row (server) and each lead row
// (client). Lives in its own plain module because a "use client" file can't
// hand plain values to a server component.
export const LEAD_GRID =
  "md:grid md:grid-cols-[36px_minmax(0,2.2fr)_150px_64px_minmax(0,1.4fr)_96px_84px] md:items-center md:gap-4";
