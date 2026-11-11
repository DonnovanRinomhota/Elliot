// Email attachments (0046): files clients attach to emails, kept in the
// private email-attachments bucket and listed on the conversation page.
// Pure helpers, unit-tested in attachments.test.ts.

export type Attachment = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded: boolean;
  read_by_elliot: boolean;
  created_at: string;
};

type Msg = { id: string; role: string; created_at: string };

/** Workflow 01 saves the client's message with "[Attached: a.pdf, b.jpg]" at the end, for Elliot's history. The page shows the files instead. */
export function withoutAttachedNote(content: string): string {
  return content.replace(/\n*\[Attached: [^\]\n]*\]\s*$/, "");
}

/**
 * Each file goes under the client's message it came with: the first client
 * message saved at or after the file (n8n saves the files a few seconds
 * before Elliot saves the message). Files with no later client message
 * (Elliot didn't answer) are returned as `unplaced`.
 */
export function placeAttachments(messages: Msg[], files: Attachment[]): { byMessage: Map<string, Attachment[]>; unplaced: Attachment[] } {
  const clientMsgs = messages.filter((m) => m.role === "user").sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const byMessage = new Map<string, Attachment[]>();
  const unplaced: Attachment[] = [];
  for (const f of [...files].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const at = Date.parse(f.created_at);
    const m = clientMsgs.find((x) => Date.parse(x.created_at) >= at - 1000);
    if (!m) unplaced.push(f);
    else byMessage.set(m.id, [...(byMessage.get(m.id) ?? []), f]);
  }
  return { byMessage, unplaced };
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function fileKind(contentType: string | null | undefined, filename = ""): "pdf" | "image" | "document" | "other" {
  const t = (contentType || "").toLowerCase();
  if (t === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (t.startsWith("image/")) return "image";
  if (/word|officedocument|opendocument|rtf|text\//.test(t) || /\.(docx?|odt|rtf|txt|xlsx?|ods|csv)$/i.test(filename)) return "document";
  return "other";
}

/** One line under the file name. */
export function attachmentNote(a: Attachment): string {
  if (!a.uploaded) return "Couldn't be saved. Ask the client to send it again.";
  const size = formatSize(a.size_bytes);
  const read = a.read_by_elliot ? "Read by Elliot" : "For the team (Elliot can't open this type)";
  return size ? `${size} · ${read}` : read;
}
