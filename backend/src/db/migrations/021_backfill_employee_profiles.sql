-- Dummy employee_profiles for every user that does not already have one (keeps existing seed data intact).

INSERT INTO employee_profiles (
  company_id,
  user_id,
  employee_code,
  designation,
  department,
  joining_date,
  employment_type,
  probation_end_date,
  annual_salary,
  salary_type
)
SELECT
  u.company_id,
  u.id,
  'AUTO-' || REPLACE(u.id::text, '-', ''),
  CASE u.role::text
    WHEN 'company_admin' THEN 'Company Administrator'
    WHEN 'super_admin' THEN 'Super Administrator'
    WHEN 'branch_manager' THEN 'Branch Manager'
    WHEN 'staff' THEN 'Staff'
    WHEN 'ca' THEN 'Chartered Accountant'
    ELSE 'Employee'
  END,
  'General',
  (CURRENT_DATE - INTERVAL '1 year')::date,
  'full_time',
  ((CURRENT_DATE - INTERVAL '1 year')::date + INTERVAL '90 days')::date,
  60000000,
  'monthly'
FROM users u
WHERE u.is_deleted = FALSE
  AND NOT EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.user_id = u.id);
