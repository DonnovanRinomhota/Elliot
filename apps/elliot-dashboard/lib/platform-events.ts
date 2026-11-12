import { humanize } from "../app/_ui/ui";

// Plain-words description of an audit_log event written by the dashboard.
export function describeEvent(type: string, details: any): string {
  switch (type) {
    case "platform.tenant_updated":
      return `Updated ${Object.keys(details?.changes ?? {}).map((k) => humanize(k).toLowerCase()).join(", ") || "account"}`;
    case "platform.view_as_started":
      return "Opened their dashboard (view as)";
    case "platform.support_permission_changed":
      return details?.required ? "Required agencies' permission for support access" : "Paused agencies' permission for support access (testing)";
    case "support.access_granted":
      return `Allowed support access for ${details?.hours === 24 ? "24 hours" : details?.hours === 168 ? "7 days" : details?.hours === 720 ? "30 days" : "a while"}`;
    case "support.access_revoked":
      return "Turned support access off";
    case "platform.alerts_updated":
      return `Changed alert settings (email ${details?.email ?? "?"}, WhatsApp ${details?.whatsapp ?? "?"})`;
    case "team.member_invited":
      return `Invited ${details?.email ?? "a team member"}`;
    case "team.member_removed":
      return `Removed ${details?.email ?? "a team member"}`;
    case "privacy.client_exported":
      return "Downloaded a client's data (access request)";
    case "privacy.client_erased":
      return details?.reason === "retention"
        ? `Deleted an inactive client (retention period): ${details?.messages ?? 0} messages`
        : `Deleted a client on request: ${details?.conversations ?? 0} conversations, ${details?.messages ?? 0} messages`;
    case "platform.trial_started":
      return `Started a ${details?.days ?? 7}-day trial`;
    default:
      return humanize(type.replace(/\./g, " "));
  }
}
