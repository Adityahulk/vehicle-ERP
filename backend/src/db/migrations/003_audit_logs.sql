-- Audit log table for tracking all CUD operations on key entities
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(20) NOT NULL,  -- 'create', 'update', 'delete'
  entity      VARCHAR(50) NOT NULL,  -- 'vehicle', 'invoice', 'loan', etc.
  entity_id   UUID NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  ip          VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
