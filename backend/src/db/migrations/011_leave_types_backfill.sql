-- Restore default leave types for companies that have none (e.g. after migration 010
-- without re-seeding). ON CONFLICT skips rows that already exist.

INSERT INTO leave_types (company_id, name, code, days_per_year, is_paid, carry_forward)
SELECT c.id, v.name, v.code, v.days_per_year, v.is_paid, v.carry_forward
FROM companies c
CROSS JOIN (VALUES
  ('Casual Leave', 'CL', 12, TRUE, FALSE),
  ('Sick Leave', 'SL', 6, TRUE, FALSE),
  ('Earned Leave', 'EL', 12, TRUE, TRUE),
  ('Leave Without Pay', 'LWP', 0, FALSE, FALSE)
) AS v(name, code, days_per_year, is_paid, carry_forward)
WHERE c.is_deleted = FALSE
ON CONFLICT (company_id, code) DO NOTHING;
