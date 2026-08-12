# Workflow Spec: 09 - Knowledge Retrieval

## Trigger
Called as a sub-workflow via n8n's "Execute Workflow" node — invoked by the Main AI Agent (`01-main-ai-agent.json`) when Claude requests the `search_company_knowledge` tool. Not directly webhook-triggered.

## Inputs
```json
{ "tenant_id": "…uuid…", "query": "3 bedroom apartments in Mokotów" }
```
Note: `tenant_id`, not `tenant_slug` — the Main Agent has already resolved the tenant by this point, so this sub-workflow takes the UUID directly.

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger, defines the `tenant_id`/`query` input contract |
| Embed Query (Voyage AI) | Embeds the search query, `input_type: 'query'` (Voyage distinguishes query vs. document embeddings for better retrieval — verify this still matters in current Voyage docs, it did as of writing) |
| Extract Embedding | Pulls the vector out of Voyage's response |
| Search Document Chunks | Calls the `match_document_chunks` Postgres RPC (from migration 0003) with `tenant_id` and the embedding |
| Format Results | Normalizes output shape to `{content, document_id, section_ref, similarity}` — matches what the Main Agent's "Build Tool Result Message" node expects |

## Credentials required
- **Voyage AI API Key (Authorization header)** — same credential as Knowledge Ingestion, reused here.
- **Elliot Postgres (service role)** — `match_document_chunks` requires `tenant_id` as an explicit function argument (not session-based RLS), so tenant isolation is enforced by the function signature itself, not by which Postgres credential runs it. This was a deliberate design choice in migration 0003, made before the RLS session-persistence bug was discovered in Phase 2 — turns out to have been the right call for this specific function.

## Error paths
- Voyage embedding call fails → Extract Embedding throws with a clear message.
- `match_document_chunks` returns 0 rows (tenant has no ingested documents yet, or nothing matches) → Format Results returns an empty array, not an error. The Main Agent's "Build Tool Result Message" node already handles this case (`results.length ? ... : 'No relevant results found in the knowledge base.'`) — Claude will correctly tell the customer it doesn't have that information rather than inventing an answer.

## Expected output
Array of 0-5 result objects:
```json
[{ "content": "...", "document_id": "…uuid…", "section_ref": null, "similarity": 0.82 }]
```

## Connecting this to the Main Agent
After importing this workflow into n8n, **copy its workflow ID** (visible in the browser URL when the workflow is open, or in the workflow list) and paste it into the Main Agent's **"Execute: Knowledge Retrieval Sub-Workflow"** node, replacing `PLACEHOLDER_KNOWLEDGE_RETRIEVAL_WORKFLOW_ID`. This is a manual one-time step — n8n workflow IDs are assigned at import time and can't be known ahead of that.
