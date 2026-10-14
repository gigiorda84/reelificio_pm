-- Fase 2: new enum values in a file of their own (Fase 1 rule D2): a value
-- added by ALTER TYPE cannot be used in the same transaction, and every file
-- runs as one transaction.

-- One outbox job per (generation, model), drained by the AI drain (D-C).
alter type job_kind add value if not exists 'ai_generate';

revoke execute on all functions in schema private from public, anon, authenticated;
