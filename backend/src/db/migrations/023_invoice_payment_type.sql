-- Add payment type for invoice capture/printing.

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50) NOT NULL DEFAULT 'Cash';

CREATE INDEX IF NOT EXISTS idx_invoices_payment_type ON invoices(payment_type);
