// POST /api/listings/extract { text, part, parts, file_name }
// One part of a document's text (PDF, Word, pasted) -> listings found in it.
// The browser splits long documents and calls this once per part; results go
// through normalizeListing() and a preview before anything is saved.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { AiNotConfiguredError, callClaudeTool } from "@/lib/anthropic";
import { EXTRACT_SYSTEM, EXTRACT_TOOL } from "@/lib/listings-ai";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  if (!(await getCurrentTenantId(supabase))) {
    return NextResponse.json({ success: false, error: "No agency found for this account." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const text = String(body?.text || "").trim();
  if (!text) return NextResponse.json({ success: false, error: "No text to read." }, { status: 400 });
  if (text.length > 12_000) return NextResponse.json({ success: false, error: "Part too long." }, { status: 413 });
  const part = Number(body?.part) || 1;
  const parts = Number(body?.parts) || 1;

  try {
    const { result } = await callClaudeTool<{ listings: unknown[] }>({
      system: EXTRACT_SYSTEM,
      user:
        `Document: ${String(body.file_name || "pasted text").slice(0, 200)} (part ${part} of ${parts}). ` +
        `Today is ${new Date().toISOString().slice(0, 10)}.\n\n<document>\n${text}\n</document>`,
      tool: EXTRACT_TOOL,
      maxTokens: 8000,
    });
    return NextResponse.json({ success: true, listings: Array.isArray(result?.listings) ? result.listings : [] });
  } catch (e) {
    const status = e instanceof AiNotConfiguredError ? 503 : 502;
    return NextResponse.json({ success: false, error: (e as Error).message }, { status });
  }
}
