-- E-Way Bill fields for TaxPro integration
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS eway_bill_no          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS eway_bill_date        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_status      VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS eway_bill_error       TEXT,
  ADD COLUMN IF NOT EXISTS transporter_id        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS transporter_name      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vehicle_no            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS transport_mode        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS distance_km           INTEGER;

COMMENT ON COLUMN invoices.eway_bill_no IS 'E-Way Bill Number from TaxPro GSP';
COMMENT ON COLUMN invoices.eway_bill_status IS 'pending | generated | cancelled | failed';

CREATE INDEX IF NOT EXISTS idx_invoices_eway_bill_no ON invoices(eway_bill_no) WHERE eway_bill_no IS NOT NULL;
