# Workflow Spec: 08 - Knowledge Ingestion

## Trigger
`POST /webhook/ingest-document` — called manually (via curl/Postman) for Phase 3. A dashboard upload UI is a later phase.

## Inputs (JSON body)
Two shapes, depending on `source_type`:

**Pasted text** (`faq`, `manual_text`, `other`, or `pdf`):
```json
{
  "tenant_slug": "zebra-dev",
  "title": "Viewing Policy FAQ",
  "source_type": "faq",
  "text": "We are open Monday through Friday...\n\nOur pricing starts at..."
}
```
`pdf` is included here deliberately: this webhook never receives a raw PDF file. The dashboard's upload form extracts text from the PDF client-side (in the browser, via pdfjs-dist) and submits it through this same pasted-text contract with `source_type: 'pdf'` — this workflow has no PDF-parsing logic of its own.

**Website** (`source_type: 'website'`):
```json
{
  "tenant_slug": "zebra-dev",
  "title": "About Us Page",
  "source_type": "website",
  "url": "https://example.com/about"
}
```
The workflow fetches the URL itself and extracts readable text server-side — see "Website fetching" below.

`source_type` must be one of: `pdf`, `website`, `faq`, `manual_text`, `other` (matches the `documents` table constraint).

## Nodes (in order)
| Node | What it does |
|---|---|
| Ingest Webhook | Receives the POST |
| Validate Input | Checks required fields; `text` required unless `source_type` is `website`, in which case `url` is required instead |
| Resolve Tenant | Looks up tenant by slug (service-role credential, same pattern as the Main Agent) |
| Merge Tenant | Combines resolved tenant_id with the input |
| Is Website? | Branches on `source_type === 'website'` |
| Fetch Website *(website branch only)* | GETs the URL as raw text/HTML, with a User-Agent header set (some sites reject requests without one) |
| Extract Website Text *(website branch only)* | Dependency-free regex-based HTML-to-text extraction — see "Website fetching" below |
| Resolve Content | Both branches converge here into one consistent `{tenant_id, title, source_type, source_url, text}` shape — see the design note below |
| Create Document Row | Inserts into `documents` with `status = 'processing'`, including `source_url` (null for non-website sources) |
| Chunk Text | Splits `text` into ~1000-character chunks on paragraph boundaries (see algorithm notes below) |
| Embed Chunk (Voyage AI) | Calls Voyage's embeddings API once per chunk, `input_type: 'document'` |
| Extract Chunk Embedding | Pulls the embedding vector out of Voyage's response |
| Insert Chunk | Writes to `document_chunks` |
| Mark Document Ready | Updates `documents.status = 'ready'` |
| Respond to Webhook | Returns `{ document_id, status, chunks_created }` |

## Website fetching — what it does and doesn't handle
`Extract Website Text` is a regex-based HTML strip, not a real DOM parser — n8n's Code node sandbox has no guaranteed npm access for something like cheerio or jsdom. It removes `<script>`/`<style>` blocks and comments, turns block-level tags into line breaks, strips remaining tags, decodes a handful of common HTML entities, and collapses whitespace. This works reasonably well for FAQ/policy/about pages with real server-rendered HTML.

**Known limitation, not hidden:** this will produce empty or garbled output on heavily JS-rendered pages (React/Vue single-page apps that render content client-side, after the initial HTML has already loaded) — a proper fix needs a headless browser (Puppeteer/Playwright), which is out of scope for an n8n Code node. Some sites will also block the fetch entirely (bot detection, login walls). If a website ingestion fails or comes back garbled, that's the likely cause — worth checking the source page's raw HTML (view-source) before assuming the extraction logic is broken.

## Why "Resolve Content" exists as its own node
Both paths (pasted text and website fetch) need to converge before `Create Document Row`, but relying on `$json` directly at that convergence point would be fragile — whichever branch actually ran determines what `$json` holds, and reading the wrong upstream node's output is exactly the class of bug already documented elsewhere in this codebase (a Postgres node's `RETURNING` clause replacing `$json`; see the lessons in `/areas/ai-business-assistant-platform.md`-style notes across other workflow specs). `Resolve Content` reads `tenant_id`/`title`/`source_type`/`url` from `Merge Tenant` specifically — always correct regardless of which branch ran — and only takes `text` from whatever fed into it. `Chunk Text` and `Create Document Row` both read from `Resolve Content`, not from `Merge Tenant` or `$json` directly, for the same reason.

## Chunking algorithm — tested, with a known limitation
The chunker splits on blank lines (paragraph breaks) and merges paragraphs together up to ~1000 characters per chunk. Tested against 4 cases before shipping:
- Normal multi-paragraph FAQ text → chunks correctly, each under target size.
- Empty/whitespace-only text → produces 0 chunks, and the code explicitly throws an error rather than silently creating an empty document.
- A single short paragraph → 1 chunk, correct.
- **A single very long paragraph with no blank-line breaks → does NOT get split**, since the algorithm only splits at paragraph boundaries. In testing, a ~2500-character single paragraph came through as one oversized chunk. This is a real, known limitation, not a hidden one — if you ingest content that's one dense wall of text (no blank lines), expect oversized chunks. Fix path if this becomes a problem: fall back to a hard character-count split within a paragraph that exceeds target size on its own. Not built now — flagging so it doesn't surprise you later, and so it can be prioritized based on what real content actually looks like.

## Credentials required
- **Elliot Postgres (service role)** — used throughout; ingestion is an internal/admin operation, not tenant-request-scoped in the same way the Main Agent's chat flow is, so RLS session complexity doesn't apply here the same way.
- **Voyage AI API Key (Authorization header)** — Header Auth credential, header name `Authorization`, value `Bearer <your-voyage-key>`. Voyage AI currently offers 200M free tokens on the voyage-4 model family — verify this is still current before assuming it's free, pricing terms change. If Voyage's free tier ever goes away, Google's `text-embedding-004` on the Gemini API free tier is the fallback alternative (would need a different HTTP call shape).

## Error paths
- Missing required field or invalid `source_type` → Validate Input throws, workflow fails immediately, nothing written to `documents`.
- Unknown tenant slug → Resolve Tenant returns no rows → Merge Tenant throws.
- Empty text after chunking → Chunk Text explicitly throws rather than creating a document with zero chunks.
- Voyage AI call fails (bad key, rate limit, no credits) → Extract Chunk Embedding throws with a message identifying which chunk failed. **Known gap:** the document row is left in `status = 'processing'` forever if this happens partway through — a document stuck in "processing" after a failed run needs manual cleanup (`update documents set status = 'failed' where id = '...'`) or a retry. Proper partial-failure handling (marking the row `failed` automatically) isn't built yet.

## Expected output
```json
{ "document_id": "…uuid…", "status": "ready", "chunks_created": 3 }
```

## Known limitations (still real, not fixed here)
- Website extraction is regex-based, not a real DOM parser — see "Website fetching" above for what that does and doesn't handle.
- PDF extraction happens client-side in the dashboard, not in this workflow — see the dashboard's `knowledge-form.tsx` for that logic and its own limitations (e.g. scanned/image-only PDFs with no real text layer).
- No de-duplication — re-ingesting the same content (or re-fetching the same URL) twice creates two separate documents with duplicate chunks.
- "Mark Document Ready" runs once per chunk (harmless but redundant) rather than once per document — a later cleanup, not a correctness issue since the update is idempotent.
