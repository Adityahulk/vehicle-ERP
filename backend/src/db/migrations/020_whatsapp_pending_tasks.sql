-- Pending WhatsApp reminder tasks for managers (loan/penalty) — compose opens wa.me on client; no API provider.

CREATE TABLE IF NOT EXISTS whatsapp_pending_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_pending_tasks_company_open
  ON whatsapp_pending_tasks (company_id, dismissed_at)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_pending_tasks_loan
  ON whatsapp_pending_tasks (loan_id);
