-- 0003_knowledge_rag.sql
-- Knowledge base + RAG: documents and their embedded chunks.

-- ─────────────────────────────────────────────────────────────
-- documents: uploaded/connected knowledge sources (metadata only — file bytes live in Supabase Storage)
-- ─────────────────────────────────────────────────────────────
create table documents (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    title           text not null,
    source_type     text not null check (source_type in ('pdf', 'website', 'faq', 'manual_text', 'other')),
    source_url      text,                                     -- for website-sourced docs
    storage_path    text,                                     -- Supabase Storage path, for uploaded files
    status          text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
    error_message   text,                                     -- populated if status='failed'
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index idx_documents_tenant on documents(tenant_id);
create index idx_documents_tenant_status on documents(tenant_id, status);

comment on table documents is 'Metadata for a knowledge source. Actual chunked/embedded content lives in document_chunks.';

-- ─────────────────────────────────────────────────────────────
-- document_chunks: embedded text chunks used for retrieval
-- ─────────────────────────────────────────────────────────────
create table document_chunks (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    document_id     uuid not null references documents(id) on delete cascade,
    chunk_index     int not null,                             -- order within the source document
    content         text not null,
    embedding       vector(1536),                              -- adjust dimension to match the embedding model actually used
    section_ref     text,                                       -- page number / heading / URL fragment, for source attribution
    created_at      timestamptz not null default now()
);

create index idx_document_chunks_tenant on document_chunks(tenant_id);
create index idx_document_chunks_document on document_chunks(document_id);

-- Approximate nearest-neighbor index for similarity search.
-- ivfflat requires ANALYZE after bulk load, and a `lists` value tuned to expected row count.
-- Start conservative; revisit once real chunk volume is known.
create index idx_document_chunks_embedding on document_chunks
    using ivfflat (embedding vector_cosine_ops) with (lists = 100);

comment on table document_chunks is 'One row per chunk. Retrieval always filters by tenant_id first, then does the vector search — tenant filtering is not optional and must not be skippable via query construction.';

create trigger trg_documents_updated_at before update on documents
    for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- retrieval helper: tenant-scoped cosine similarity search
-- Called from n8n's Knowledge Retrieval workflow via RPC, not raw SQL,
-- so the tenant filter can never accidentally be omitted by a caller.
-- ─────────────────────────────────────────────────────────────
create or replace function match_document_chunks(
    p_tenant_id uuid,
    p_query_embedding vector(1536),
    p_match_count int default 5
)
returns table (
    chunk_id uuid,
    document_id uuid,
    content text,
    section_ref text,
    similarity float
)
language sql stable
as $$
    select
        dc.id as chunk_id,
        dc.document_id,
        dc.content,
        dc.section_ref,
        1 - (dc.embedding <=> p_query_embedding) as similarity
    from document_chunks dc
    where dc.tenant_id = p_tenant_id
    order by dc.embedding <=> p_query_embedding
    limit p_match_count;
$$;

comment on function match_document_chunks is 'Tenant-scoped vector search. p_tenant_id is required (not optional) precisely so this function cannot be called in a way that leaks another tenant''s knowledge base.';
