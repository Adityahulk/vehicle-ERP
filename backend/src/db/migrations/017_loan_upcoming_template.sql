-- Backfill loan_due_soon template for companies

INSERT INTO whatsapp_templates (company_id, name, message_type, template_body)
SELECT c.id, 'Loan upcoming reminder', 'loan_due_soon',
'Dear {customer_name},

This is a friendly reminder that your upcoming loan payment for {vehicle} is due next week.

Due Date: {due_date}

To avoid late payment penalties, please make sure your payment is completed on or before the due date.

📞 {branch_phone}

— {company_name}'
FROM companies c WHERE c.is_deleted = FALSE
ON CONFLICT (company_id, message_type) DO NOTHING;
