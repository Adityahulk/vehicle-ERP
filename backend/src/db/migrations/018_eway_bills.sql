-- Migration: 018_eway_bills.sql
-- Add branches fields for E-Way Bill and create eway_bills table

BEGIN;

ALTER TABLE branches 
  ADD COLUMN IF NOT EXISTS city varchar(200),
  ADD COLUMN IF NOT EXISTS state varchar(200),
  ADD COLUMN IF NOT EXISTS pincode varchar(10),
  ADD COLUMN IF NOT EXISTS state_code varchar(5);

CREATE TABLE IF NOT EXISTS eway_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  reference_type varchar(20) NOT NULL, -- 'transfer' or 'sale'
  reference_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  eway_bill_number varchar(50),
  generated_json jsonb NOT NULL,
  status varchar(20) DEFAULT 'draft', -- 'draft', 'submitted', 'cancelled'
  valid_from timestamptz,
  valid_until timestamptz,
  distance_km integer,
  notes text,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eway_bills_company_id ON eway_bills(company_id);
CREATE INDEX IF NOT EXISTS idx_eway_bills_reference ON eway_bills(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_eway_bills_vehicle_id ON eway_bills(vehicle_id);

COMMIT;
