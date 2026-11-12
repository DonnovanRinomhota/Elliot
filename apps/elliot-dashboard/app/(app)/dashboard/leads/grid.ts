// Column layout shared by the Leads header row (server) and each lead row
// (client). Lives in its own plain module because a "use client" file can't
// hand plain values to a server component. Below xl the row stacks.
export const LEAD_GRID =
  "xl:grid xl:grid-cols-[minmax(0,2fr)_40px_128px_92px_minmax(0,1.5fr)_52px_minmax(0,1.25fr)_96px_70px] xl:items-center xl:gap-3";
