-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE companies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID REFERENCES companies(id),
  name          VARCHAR(255) NOT NULL,
  gstin         VARCHAR(15),
  address       TEXT,
  phone         VARCHAR(20),
  email         VARCHAR(255),
  logo_url      TEXT,
  signature_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_companies_is_deleted ON companies(is_deleted);

-- ============================================================
-- BRANCHES
-- ============================================================
CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  name        VARCHAR(255) NOT NULL,
  address     TEXT,
  phone       VARCHAR(20),
  manager_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_branches_company_id ON branches(company_id);
CREATE INDEX idx_branches_is_deleted ON branches(is_deleted);

-- ============================================================
-- USERS
-- ============================================================
CREATE TYPE user_role AS ENUM ('super_admin', 'company_admin', 'branch_manager', 'staff');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  branch_id     UUID REFERENCES branches(id),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(20),
  role          user_role NOT NULL DEFAULT 'staff',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_users_email_company ON users(email, company_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_role ON users(role);

-- Now add FK on branches.manager_id → users.id
ALTER TABLE branches ADD CONSTRAINT fk_branches_manager FOREIGN KEY (manager_id) REFERENCES users(id);

-- ============================================================
-- VEHICLES
-- ============================================================
CREATE TYPE vehicle_status AS ENUM ('in_stock', 'sold', 'transferred', 'scrapped');

CREATE TABLE vehicles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  chassis_number    VARCHAR(50) NOT NULL,
  engine_number     VARCHAR(50) NOT NULL,
  make              VARCHAR(100),
  model             VARCHAR(100),
  variant           VARCHAR(100),
  color             VARCHAR(50),
  year              INTEGER,
  purchase_price    BIGINT NOT NULL DEFAULT 0,
  selling_price     BIGINT NOT NULL DEFAULT 0,
  status            vehicle_status NOT NULL DEFAULT 'in_stock',
  rto_number        VARCHAR(20),
  rto_date          DATE,
  insurance_company VARCHAR(255),
  insurance_expiry  DATE,
  insurance_number  VARCHAR(100),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_vehicles_chassis_company ON vehicles(chassis_number, company_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_vehicles_company_id ON vehicles(company_id);
CREATE INDEX idx_vehicles_branch_id ON vehicles(branch_id);
CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_created_at ON vehicles(created_at);

-- ============================================================
-- VEHICLE TRANSFERS
-- ============================================================
CREATE TABLE vehicle_transfers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
  from_branch_id  UUID NOT NULL REFERENCES branches(id),
  to_branch_id    UUID NOT NULL REFERENCES branches(id),
  transferred_by  UUID NOT NULL REFERENCES users(id),
  notes           TEXT,
  transferred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_vehicle_transfers_company_id ON vehicle_transfers(company_id);
CREATE INDEX idx_vehicle_transfers_vehicle_id ON vehicle_transfers(vehicle_id);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  name        VARCHAR(255) NOT NULL,
  phone       VARCHAR(20),
  email       VARCHAR(255),
  address     TEXT,
  gstin       VARCHAR(15),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_customers_company_id ON customers(company_id);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TYPE invoice_status AS ENUM ('draft', 'confirmed', 'cancelled');

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  branch_id       UUID REFERENCES branches(id),
  invoice_number  VARCHAR(50) NOT NULL,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  vehicle_id      UUID REFERENCES vehicles(id),
  subtotal        BIGINT NOT NULL DEFAULT 0,
  discount        BIGINT NOT NULL DEFAULT 0,
  cgst_amount     BIGINT NOT NULL DEFAULT 0,
  sgst_amount     BIGINT NOT NULL DEFAULT 0,
  igst_amount     BIGINT NOT NULL DEFAULT 0,
  total           BIGINT NOT NULL DEFAULT 0,
  status          invoice_status NOT NULL DEFAULT 'draft',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_invoices_number_company ON invoices(invoice_number, company_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_invoices_company_id ON invoices(company_id);
CREATE INDEX idx_invoices_branch_id ON invoices(branch_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX idx_invoices_created_at ON invoices(created_at);

-- ============================================================
-- INVOICE ITEMS
-- ============================================================
CREATE TABLE invoice_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id),
  description VARCHAR(500) NOT NULL,
  hsn_code    VARCHAR(20),
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  BIGINT NOT NULL DEFAULT 0,
  cgst_rate   DECIMAL(5,2) NOT NULL DEFAULT 0,
  sgst_rate   DECIMAL(5,2) NOT NULL DEFAULT 0,
  igst_rate   DECIMAL(5,2) NOT NULL DEFAULT 0,
  cgst_amount BIGINT NOT NULL DEFAULT 0,
  sgst_amount BIGINT NOT NULL DEFAULT 0,
  igst_amount BIGINT NOT NULL DEFAULT 0,
  amount      BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_company_id ON invoice_items(company_id);

-- ============================================================
-- LOANS
-- ============================================================
CREATE TYPE loan_status AS ENUM ('active', 'closed', 'overdue');

CREATE TABLE loans (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  invoice_id            UUID REFERENCES invoices(id),
  customer_id           UUID NOT NULL REFERENCES customers(id),
  bank_name             VARCHAR(255),
  loan_amount           BIGINT NOT NULL DEFAULT 0,
  interest_rate         DECIMAL(5,2) NOT NULL DEFAULT 0,
  tenure_months         INTEGER NOT NULL DEFAULT 0,
  emi_amount            BIGINT NOT NULL DEFAULT 0,
  disbursement_date     DATE,
  due_date              DATE,
  penalty_per_day       BIGINT NOT NULL DEFAULT 0,
  total_penalty_accrued BIGINT NOT NULL DEFAULT 0,
  status                loan_status NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_loans_company_id ON loans(company_id);
CREATE INDEX idx_loans_customer_id ON loans(customer_id);
CREATE INDEX idx_loans_status ON loans(status);

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  branch_id   UUID REFERENCES branches(id),
  category    VARCHAR(100) NOT NULL,
  description TEXT,
  amount      BIGINT NOT NULL DEFAULT 0,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_expenses_company_id ON expenses(company_id);
CREATE INDEX idx_expenses_branch_id ON expenses(branch_id);
CREATE INDEX idx_expenses_created_at ON expenses(created_at);

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE attendance (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  branch_id   UUID REFERENCES branches(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  date        DATE NOT NULL,
  clock_in    TIMESTAMPTZ,
  clock_out   TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_attendance_user_date ON attendance(user_id, date) WHERE is_deleted = FALSE;
CREATE INDEX idx_attendance_company_id ON attendance(company_id);
CREATE INDEX idx_attendance_branch_id ON attendance(branch_id);
CREATE INDEX idx_attendance_date ON attendance(date);

-- ============================================================
-- QUOTATIONS
-- ============================================================
CREATE TYPE quotation_status AS ENUM ('draft', 'sent', 'accepted', 'rejected');

CREATE TABLE quotations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  branch_id         UUID REFERENCES branches(id),
  quotation_number  VARCHAR(50) NOT NULL,
  customer_id       UUID NOT NULL REFERENCES customers(id),
  vehicle_id        UUID REFERENCES vehicles(id),
  valid_until       DATE,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,
  total             BIGINT NOT NULL DEFAULT 0,
  status            quotation_status NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_quotations_number_company ON quotations(quotation_number, company_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_quotations_company_id ON quotations(company_id);
CREATE INDEX idx_quotations_branch_id ON quotations(branch_id);
CREATE INDEX idx_quotations_status ON quotations(status);
CREATE INDEX idx_quotations_created_at ON quotations(created_at);

-- ============================================================
-- REFRESH TOKENS (for JWT auth)
-- ============================================================
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id),
  token       VARCHAR(500) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);

-- ============================================================
-- updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'companies','branches','users','vehicles','vehicle_transfers',
      'customers','invoices','invoice_items','loans','expenses',
      'attendance','quotations'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      tbl
    );
  END LOOP;
END;
$$;
