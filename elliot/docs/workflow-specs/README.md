# n8n Workflow Specs

One markdown file per workflow, written before that workflow is built. Each spec covers:

- Trigger
- Inputs
- Nodes (in order, with config)
- Data passed between nodes
- Credentials required
- Error paths
- Expected output

Planned workflows (see /docs/architecture.md section 4 for the full list and build order):

1. main-ai-agent.md
2. customer-support.md
3. lead-capture.md
4. lead-qualification.md
5. appointment-management.md
6. email-processing.md
7. follow-up-engine.md
8. knowledge-ingestion.md
9. knowledge-retrieval.md
10. crm-synchronization.md
11. human-escalation.md
12. notifications.md
13. error-handling.md
14. scheduled-tasks.md

None of these exist yet — they get written just before each workflow is built, not all up front.
