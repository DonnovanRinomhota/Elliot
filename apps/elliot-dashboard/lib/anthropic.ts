// Server-only: one Claude call that must answer through a given tool, so the
// result is structured JSON. Used by the listings import (plan + extract).
//
// Env (Vercel, server-only):
//   ANTHROPIC_API_KEY  required for "read any file" imports
//   ANTHROPIC_MODEL    optional, defaults to the model workflow 01 uses
//   ANTHROPIC_BASE_URL optional, e.g. for a proxy; defaults to https://api.anthropic.com

export class AiNotConfiguredError extends Error {}

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export async function callClaudeTool<T>({
  system,
  user,
  tool,
  maxTokens = 8000,
}: {
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}): Promise<{ result: T; usage: { input_tokens: number; output_tokens: number } }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AiNotConfiguredError(
      "Reading files with AI isn't switched on yet: add ANTHROPIC_API_KEY in Vercel (dashboard project) and redeploy. Excel and CSV files in Elliot's template format still work without it."
    );
  }

  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `Claude returned ${res.status}`;
    throw new Error(res.status === 429 || res.status === 529 ? "Claude is busy right now. Try again in a minute." : msg);
  }
  const block = (data?.content || []).find((b: any) => b.type === "tool_use" && b.name === tool.name);
  if (!block) throw new Error("Claude didn't return a result. Try again.");
  if (data.stop_reason === "max_tokens") {
    throw new Error("This part of the file was too long to read in one go. Try a smaller file or split it.");
  }
  return { result: block.input as T, usage: data.usage ?? { input_tokens: 0, output_tokens: 0 } };
}
