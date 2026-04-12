-- Automatic loan penalty: grace, cap, waiver tracking, audit log, job logs

ALTER TABLE loans ADD COLUMN IF NOT EXISTS grace_period_days INTEGER NOT NULL DEFAULT 0;
-- penalty_per_day, total_penalty_accrued already exist (BIGINT, paise)

ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_cap BIGINT NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_waived BIGINT NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_waived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_waived_at TIMESTAMPTZ;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_waive_note TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS last_penalty_calc_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS loan_penalty_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id          UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  calc_date        DATE NOT NULL,
  overdue_days     INTEGER NOT NULL,
  penalty_per_day  BIGINT NOT NULL,
  penalty_added    BIGINT NOT NULL,
  running_total    BIGINT NOT NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, calc_date)
);

CREATE INDEX IF NOT EXISTS idx_loan_penalty_log_loan ON loan_penalty_log(loan_id, calc_date DESC);
CREATE INDEX IF NOT EXISTS idx_loan_penalty_log_company ON loan_penalty_log(company_id, calc_date DESC);

CREATE TABLE IF NOT EXISTS job_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name   VARCHAR(100) NOT NULL,
  run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_name ON job_logs(job_name, run_at DESC);
