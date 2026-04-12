-- WhatsApp templates, send logs, share links support, loan reminder tracking

ALTER TABLE loans ADD COLUMN IF NOT EXISTS last_reminder_sent DATE;

CREATE TABLE whatsapp_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_phone       VARCHAR(20) NOT NULL,
  recipient_name        VARCHAR(200),
  message_type          VARCHAR(50) NOT NULL,
  reference_id          UUID,
  reference_type        VARCHAR(50),
  message_body          TEXT NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  provider_message_id   VARCHAR(200),
  error_message         TEXT,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_whatsapp_logs_status CHECK (status IN ('pending', 'sent', 'delivered', 'failed'))
);

CREATE INDEX idx_whatsapp_logs_company ON whatsapp_logs(company_id);
CREATE INDEX idx_whatsapp_logs_reference ON whatsapp_logs(company_id, reference_type, reference_id);
CREATE INDEX idx_whatsapp_logs_created ON whatsapp_logs(company_id, created_at DESC);

CREATE TABLE whatsapp_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  message_type    VARCHAR(50) NOT NULL,
  template_body   TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, message_type)
);

CREATE INDEX idx_whatsapp_templates_company ON whatsapp_templates(company_id) WHERE is_active = TRUE;

CREATE TRIGGER set_updated_at_whatsapp_templates
  BEFORE UPDATE ON whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed default templates for every existing company
INSERT INTO whatsapp_templates (company_id, name, message_type, template_body)
SELECT c.id, 'Loan overdue', 'loan_overdue', $t1$
Dear {customer_name},

Your vehicle loan for {vehicle} is overdue.

Due Date: {due_date}
Overdue By: {overdue_days} days
Outstanding Penalty: ₹{penalty}

Please contact us immediately to avoid further charges.
📞 {branch_phone}

— {company_name}
$t1$
FROM companies c WHERE c.is_deleted = FALSE
ON CONFLICT (company_id, message_type) DO NOTHING;

INSERT INTO whatsapp_templates (company_id, name, message_type, template_body)
SELECT c.id, 'Invoice share', 'invoice_share', $t2$
Dear {customer_name},

Thank you for your purchase from {company_name}!

Invoice No: {invoice_number}
Vehicle: {vehicle}
Amount: ₹{amount}

View/Download your invoice: {share_link}

For any queries, call us at {branch_phone}

— {company_name}
$t2$
FROM companies c WHERE c.is_deleted = FALSE
ON CONFLICT (company_id, message_type) DO NOTHING;

INSERT INTO whatsapp_templates (company_id, name, message_type, template_body)
SELECT c.id, 'Quotation share', 'quotation_share', $t3$
Dear {customer_name},

Please find your quotation from {company_name}.

Quotation No: {quotation_number}
Vehicle: {vehicle}
Total: ₹{amount}
Valid Until: {valid_until}

View quotation: {share_link}

To confirm your booking or for queries:
📞 {branch_phone}

— {company_name}
$t3$
FROM companies c WHERE c.is_deleted = FALSE
ON CONFLICT (company_id, message_type) DO NOTHING;

INSERT INTO whatsapp_templates (company_id, name, message_type, template_body)
SELECT c.id, 'Loan penalty alert', 'loan_penalty_alert', $t4$
Dear {customer_name},

This is a reminder that your loan payment for {vehicle} is pending.

Due Date: {due_date}
Days Overdue: {overdue_days}
Daily Penalty: ₹{penalty_per_day}
Total Penalty So Far: ₹{penalty}

Please clear your dues to stop penalty accumulation.
📞 {branch_phone}

— {company_name}
$t4$
FROM companies c WHERE c.is_deleted = FALSE
ON CONFLICT (company_id, message_type) DO NOTHING;
