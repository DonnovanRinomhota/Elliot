// POST /api/listings/plan { file_name, sheet, table }
// table = describeTable() output: column letters, headers, example values,
// a few sample rows. Returns a recipe (lib/listings-import.ts) that the
// browser applies to every row. Only these samples are sent to Claude, not
// the whole file.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { AiNotConfiguredError, callClaudeTool } from "@/lib/anthropic";
import { PLAN_SYSTEM, RECIPE_TOOL, cleanRecipe } from "@/lib/listings-ai";

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
  const table = body?.table;
  if (!table?.columns?.length) return NextResponse.json({ success: false, error: "No columns to read." }, { status: 400 });
  const payload = JSON.stringify(table);
  if (payload.length > 80_000) {
    return NextResponse.json({ success: false, error: "That sheet has too many columns to read. Remove columns you don't need and try again." }, { status: 413 });
  }

  try {
    const { result } = await callClaudeTool<any>({
      system: PLAN_SYSTEM,
      user:
        `File: ${String(body.file_name || "listings").slice(0, 200)}${body.sheet ? `, sheet "${String(body.sheet).slice(0, 100)}"` : ""}.\n` +
        `Today is ${new Date().toISOString().slice(0, 10)}.\n\n` +
        `Columns, examples and sample rows (JSON):\n${payload}`,
      tool: RECIPE_TOOL,
      maxTokens: 6000,
    });
    const recipe = cleanRecipe(result);
    const known = new Set(table.columns.map((c: any) => c.letter));
    const unknown = Object.values<any>(recipe.fields).filter((f) => f.column && !known.has(f.column));
    if (!recipe.fields.title || unknown.length) {
      return NextResponse.json({ success: false, error: "Elliot couldn't work out this file. Check it has one row per property and try again." }, { status: 422 });
    }
    return NextResponse.json({ success: true, recipe });
  } catch (e) {
    const status = e instanceof AiNotConfiguredError ? 503 : 502;
    return NextResponse.json({ success: false, error: (e as Error).message }, { status });
  }
}
