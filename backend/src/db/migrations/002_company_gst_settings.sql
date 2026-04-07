-- Add GST settings columns to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS state_code VARCHAR(2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_hsn_code VARCHAR(20) DEFAULT '8703';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_gst_rate DECIMAL(5,2) DEFAULT 28.00;
