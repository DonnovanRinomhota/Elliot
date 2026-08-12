# Workflow Spec: 08 - Knowledge Ingestion

## Trigger
`POST /webhook/ingest-document` — called manually (via curl/Postman) for Phase 3. A dashboard upload UI is a later phase.

## Inputs (JSON body)
```json
{
  "tenant_slug": "zebra-dev",
  "title": "Viewing Policy FAQ",
  "source_type": "faq",
  "text": "We are open Monday through Friday...\n\nOur pricing starts at..."
}
```
- `source_type` must be one of: `pdf`, `website`, `faq`, `manual_text`, `other` (matches the `documents` table constraint).
- **Phase 3 scope is plain text only.** `text` is the actual content to ingest — pasted in directly, not a file upload. PDF text extraction and website scraping are explicitly NOT built yet (see "Known limitations" below).

## Nodes (in order)
| Node | What it does |
|---|---|
| Ingest Webhook | Receives the POST |
| Validate Input | Checks required fields and that `source_type` is a valid value |
| Resolve Tenant | Looks up tenant by slug (service-role credential, same pattern as the Main Agent) |
| Merge Tenant | Combines resolved tenant_id with the input |
| Create Document Row | Inserts into `documents` with `status = 'processing'` |
| Chunk Text | Splits `text` into ~1000-character chunks on paragraph boundaries (see algorithm notes below) |
| Embed Chunk (Voyage AI) | Calls Voyage's embeddings API once per chunk, `input_type: 'document'` |
| Extract Chunk Embedding | Pulls the embedding vector out of Voyage's response |
| Insert Chunk | Writes to `document_chunks` |
| Mark Document Ready | Updates `documents.status = 'ready'` |
| Respond to Webhook | Returns `{ document_id, status, chunks_created }` |

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

## Known limitations (Phase 3 scope, not bugs)
- No PDF or website ingestion — plain text only.
- No de-duplication — re-ingesting the same content twice creates two separate documents with duplicate chunks.
- "Mark Document Ready" runs once per chunk (harmless but redundant) rather than once per document — a later cleanup, not a correctness issue since the update is idempotent.
