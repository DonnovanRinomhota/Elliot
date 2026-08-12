-- 0010_fix_embedding_dimension.sql
--
-- The original document_chunks.embedding column was defined as vector(1536)
-- in migration 0003, before Voyage AI was chosen as the embedding provider.
-- voyage-4-lite (the model actually used in 08-knowledge-ingestion.json and
-- 09-knowledge-retrieval.json) outputs 1024-dimension vectors, not 1536.
-- Confirmed via direct testing: inserting a 1024-dim vector into the old
-- column fails with "expected 1536 dimensions, not 1024".
--
-- Safe to run even if document_chunks already has rows with the wrong
-- dimension (there shouldn't be any real ones, since every insert attempt
-- would have failed) -- but this ALTER will fail loudly if any row's vector
-- doesn't match, which is the correct, safe behavior: better a clear error
-- here than silently corrupting data.

alter table document_chunks
    alter column embedding type vector(1024);

-- The ivfflat index on embedding was built against the old column type and
-- needs to be dropped and recreated to match.
drop index if exists idx_document_chunks_embedding;
create index idx_document_chunks_embedding on document_chunks
    using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- match_document_chunks (from migration 0003) takes p_query_embedding as
-- vector(1536) explicitly in its signature -- must be updated to match, or
-- retrieval will hit the same dimension error Knowledge Ingestion just hit.
create or replace function match_document_chunks(
    p_tenant_id uuid,
    p_query_embedding vector(1024),
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

comment on function match_document_chunks is 'Tenant-scoped vector search. Updated in migration 0010 to vector(1024) to match voyage-4-lite output dimension -- if the embedding model ever changes, this signature and the document_chunks.embedding column both need to change together.';
