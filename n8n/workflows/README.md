# Workflow Logic Tests

n8n Code node logic extracted and tested standalone with plain `node`, since n8n workflows can't be unit tested in place. Run any file directly: `node <filename>.js`.

- `chunking_logic.test.js` — tests the paragraph-based chunking algorithm used in `08-knowledge-ingestion.json`'s "Chunk Text" node. Covers: normal multi-paragraph text, empty input, a single short paragraph, and a known limitation (a single long paragraph with no blank-line breaks doesn't get split and produces an oversized chunk — see `docs/workflow-specs/08-knowledge-ingestion.md` for the fix path if this becomes a real problem).

When you change a Code node's logic in one of the workflow JSON files, update the matching test here and re-run it before re-exporting/re-importing into n8n — catching a logic bug this way is much faster than debugging it through n8n's UI node by node.
