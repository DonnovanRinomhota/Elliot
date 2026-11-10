import { humanize } from "../app/_ui/ui";

// Plain-words description of an audit_log event written by the dashboard.
export function describeEvent(type: string, details: any): string {
  switch (type) {
    case "platform.tenant_updated":
      return `Updated ${Object.keys(details?.changes ?? {}).map((k) => humanize(k).toLowerCase()).join(", ") || "account"}`;
    case "platform.view_as_started":
      return "Opened their dashboard (view as)";
    case "platform.alerts_updated":
      return `Changed alert settings (email ${details?.email ?? "?"}, WhatsApp ${details?.whatsapp ?? "?"})`;
    case "team.member_invited":
      return `Invited ${details?.email ?? "a team member"}`;
    case "team.member_removed":
      return `Removed ${details?.email ?? "a team member"}`;
    default:
      return humanize(type.replace(/\./g, " "));
  }
}
