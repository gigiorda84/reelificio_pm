-- Fase 1 (docs/fase1-plan.md §S1) — new values on existing enums.
--
-- Kept in their own file: a value added with ALTER TYPE ... ADD VALUE cannot
-- be used in the transaction that adds it, and every migration file runs as
-- one transaction. The files after this one use them.
--
-- Task notifications reuse `assignment`, `phase_approval_request` and
-- `phase_rejected`; these are the events with no existing equivalent.

alter type notification_event add value if not exists 'task_overdue';
alter type notification_event add value if not exists 'task_escalated';
alter type notification_event add value if not exists 'text_proposal';

alter type alert_kind add value if not exists 'job_health';
