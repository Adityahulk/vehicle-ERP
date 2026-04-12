-- Staff HR / employment profiles (not full payroll)

CREATE TABLE employee_profiles (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_code             VARCHAR(50),
  designation               VARCHAR(200) NOT NULL,
  department                VARCHAR(100),
  joining_date              DATE NOT NULL,
  employment_type           VARCHAR(50) NOT NULL DEFAULT 'full_time',
  probation_end_date        DATE,
  annual_salary             BIGINT NOT NULL,
  salary_type               VARCHAR(20) NOT NULL DEFAULT 'monthly',
  bank_name                 VARCHAR(200),
  bank_account_number       VARCHAR(100),
  bank_ifsc                 VARCHAR(20),
  pan_number                VARCHAR(20),
  aadhar_number             VARCHAR(20),
  emergency_contact_name    VARCHAR(200),
  emergency_contact_phone   VARCHAR(20),
  address                   TEXT,
  notes                     TEXT,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  resigned_at               DATE,
  resignation_reason        TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_employee_profiles_user UNIQUE (user_id),
  CONSTRAINT chk_employee_employment_type CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'probation')),
  CONSTRAINT chk_employee_salary_type CHECK (salary_type IN ('monthly', 'daily', 'hourly'))
);

CREATE INDEX idx_employee_profiles_company ON employee_profiles(company_id);
CREATE INDEX idx_employee_profiles_code ON employee_profiles(company_id, employee_code);

CREATE TABLE salary_revisions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  effective_date  DATE NOT NULL,
  old_salary      BIGINT NOT NULL,
  new_salary      BIGINT NOT NULL,
  reason          TEXT,
  revised_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_salary_revisions_employee ON salary_revisions(employee_id, effective_date DESC);

CREATE TRIGGER set_updated_at_employee_profiles
  BEFORE UPDATE ON employee_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
