/**
 * Default WhatsApp templates per company (same bodies as migration 012).
 */
const TEMPLATES = [
  {
    name: 'Loan overdue',
    message_type: 'loan_overdue',
    template_body: `Dear {customer_name},

Your vehicle loan for {vehicle} is overdue.

Due Date: {due_date}
Overdue By: {overdue_days} days
Outstanding Penalty: ₹{penalty}

Please contact us immediately to avoid further charges.
📞 {branch_phone}

— {company_name}`,
  },
  {
    name: 'Invoice share',
    message_type: 'invoice_share',
    template_body: `Dear {customer_name},

Thank you for your purchase from {company_name}!

Invoice No: {invoice_number}
Vehicle: {vehicle}
Amount: ₹{amount}

View/Download your invoice: {share_link}

For any queries, call us at {branch_phone}

— {company_name}`,
  },
  {
    name: 'Quotation share',
    message_type: 'quotation_share',
    template_body: `Dear {customer_name},

Please find your quotation from {company_name}.

Quotation No: {quotation_number}
Vehicle: {vehicle}
Total: ₹{amount}
Valid Until: {valid_until}

View quotation: {share_link}

To confirm your booking or for queries:
📞 {branch_phone}

— {company_name}`,
  },
  {
    name: 'Loan penalty alert',
    message_type: 'loan_penalty_alert',
    template_body: `Dear {customer_name},

This is a reminder that your loan payment for {vehicle} is pending.

Due Date: {due_date}
Days Overdue: {overdue_days}
Daily Penalty: ₹{penalty_per_day}
Total Penalty So Far: ₹{penalty}

Please clear your dues to stop penalty accumulation.
📞 {branch_phone}

— {company_name}`,
  },
];

async function seedWhatsappTemplates(companyId, client = null) {
  const q = client ? client.query.bind(client) : require('../config/db').query;
  for (const t of TEMPLATES) {
    await q(
      `INSERT INTO whatsapp_templates (company_id, name, message_type, template_body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, message_type) DO NOTHING`,
      [companyId, t.name, t.message_type, t.template_body],
    );
  }
}

module.exports = { seedWhatsappTemplates, TEMPLATES };
