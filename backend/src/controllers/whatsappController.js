const { query } = require('../config/db');
const ic = require('./invoicesController');
const {
  sendWhatsApp,
  sendCustomMessage,
  generateShareLink,
  validateTemplatePlaceholders,
} = require('../services/whatsappService');
const { calculatePenalty } = require('../services/penaltyService');
const { loadQuotationBundle } = require('./quotationsController');

function fmtRupees(paise) {
  return (Number(paise || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function sendInvoiceWhatsApp(req, res) {
  try {
    const { invoiceId } = req.params;
    const companyId = req.user.company_id;
    const { role, branch_id: userBranch } = req.user;

    const data = await ic.fetchFullInvoice(invoiceId, companyId);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });

    const inv = data.invoice;
    if (role === 'staff' || role === 'branch_manager') {
      if (String(inv.branch_id) !== String(userBranch)) {
        return res.status(403).json({ error: 'Not allowed for this branch' });
      }
    }

    let phone = inv.customer_phone;
    if (req.body?.phone && String(req.body.phone).replace(/\D/g, '').length >= 10) {
      phone = req.body.phone;
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'Customer has no phone number on record' });
    }

    const vehicle = [inv.vehicle_make, inv.vehicle_model].filter(Boolean).join(' ') || 'N/A';
    const shareLink = generateShareLink('invoice', invoiceId, companyId);
    const variables = {
      customer_name: inv.customer_name || 'Customer',
      company_name: inv.company_name || 'Our dealership',
      invoice_number: inv.invoice_number,
      vehicle,
      amount: fmtRupees(inv.total),
      share_link: shareLink,
      branch_phone: inv.branch_phone || inv.company_phone || 'N/A',
    };

    const bodyOverride = req.body?.message;
    let previewMessage;
    let result;
    if (bodyOverride && String(bodyOverride).trim()) {
      result = await sendCustomMessage({
        companyId,
        recipientPhone: phone,
        recipientName: inv.customer_name,
        messageBody: String(bodyOverride).trim(),
        triggeredByUserId: req.user.id,
      });
      previewMessage = String(bodyOverride).trim();
    } else {
      result = await sendWhatsApp({
        companyId,
        recipientPhone: phone,
        recipientName: inv.customer_name,
        messageType: 'invoice_share',
        referenceId: invoiceId,
        referenceType: 'invoice',
        variables,
        triggeredByUserId: req.user.id,
      });
      previewMessage = result.previewMessage;
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error, previewMessage });
    }
    res.json({ success: true, logId: result.logId, previewMessage });
  } catch (err) {
    console.error('sendInvoiceWhatsApp:', err.message);
    res.status(500).json({ error: 'Failed to send WhatsApp' });
  }
}

async function sendQuotationWhatsApp(req, res) {
  try {
    const { quotationId } = req.params;
    const companyId = req.user.company_id;
    const { role, branch_id: userBranch } = req.user;

    const bundle = await loadQuotationBundle(quotationId, companyId);
    if (!bundle || bundle.quotation.is_deleted) {
      return res.status(404).json({ error: 'Quotation not found' });
    }
    const qrow = bundle.quotation;
    if (role === 'staff' || role === 'branch_manager') {
      if (String(qrow.branch_id) !== String(userBranch)) {
        return res.status(403).json({ error: 'Not allowed for this branch' });
      }
    }

    let phone = qrow.customer_phone_override || bundle.customer?.phone;
    if (req.body?.phone && String(req.body.phone).replace(/\D/g, '').length >= 10) {
      phone = req.body.phone;
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'Customer has no phone number on record' });
    }

    const vehicle = [qrow.vehicle_make, qrow.vehicle_model].filter(Boolean).join(' ') || 'N/A';
    const shareLink = generateShareLink('quotation', quotationId, companyId);
    const custName = qrow.customer_name_override || bundle.customer?.name || 'Customer';

    const { rows: co } = await query(`SELECT name, phone FROM companies WHERE id = $1`, [companyId]);
    const { rows: br } = await query(`SELECT phone FROM branches WHERE id = $1`, [qrow.branch_id]);

    const variables = {
      customer_name: custName,
      company_name: co[0]?.name || 'Our dealership',
      quotation_number: qrow.quotation_number,
      vehicle,
      amount: fmtRupees(qrow.total),
      valid_until: fmtDate(qrow.valid_until_date),
      share_link: shareLink,
      branch_phone: br[0]?.phone || co[0]?.phone || 'N/A',
    };

    const bodyOverride = req.body?.message;
    let previewMessage;
    let result;
    if (bodyOverride && String(bodyOverride).trim()) {
      result = await sendCustomMessage({
        companyId,
        recipientPhone: phone,
        recipientName: custName,
        messageBody: String(bodyOverride).trim(),
        triggeredByUserId: req.user.id,
      });
      previewMessage = String(bodyOverride).trim();
    } else {
      result = await sendWhatsApp({
        companyId,
        recipientPhone: phone,
        recipientName: custName,
        messageType: 'quotation_share',
        referenceId: quotationId,
        referenceType: 'quotation',
        variables,
        triggeredByUserId: req.user.id,
      });
      previewMessage = result.previewMessage;
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error, previewMessage });
    }
    res.json({ success: true, logId: result.logId, previewMessage });
  } catch (err) {
    console.error('sendQuotationWhatsApp:', err.message);
    res.status(500).json({ error: 'Failed to send WhatsApp' });
  }
}

async function sendCustom(req, res) {
  try {
    const { phone, message } = req.body || {};
    if (!phone || !message || !String(message).trim()) {
      return res.status(400).json({ error: 'phone and message are required' });
    }
    const result = await sendCustomMessage({
      companyId: req.user.company_id,
      recipientPhone: phone,
      recipientName: null,
      messageBody: String(message).trim(),
      triggeredByUserId: req.user.id,
    });
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, logId: result.logId });
  } catch (err) {
    console.error('sendCustom WhatsApp:', err.message);
    res.status(500).json({ error: 'Failed to send' });
  }
}

async function previewLoanMessage(req, res) {
  try {
    const { loanId } = req.params;
    const companyId = req.user.company_id;
    const { rows } = await query(
      `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
              i.id AS invoice_id, v.make AS vehicle_make, v.model AS vehicle_model,
              v.chassis_number, b.phone AS branch_phone, co.name AS company_name
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       LEFT JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN branches b ON b.id = i.branch_id
       JOIN companies co ON co.id = l.company_id
       WHERE l.id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE`,
      [loanId, companyId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Loan not found' });
    const loan = rows[0];
    const calc = calculatePenalty(loan);
    const chassis = loan.chassis_number ? String(loan.chassis_number).slice(-6) : '';
    const vehicle = [loan.vehicle_make, loan.vehicle_model, chassis && `…${chassis}`].filter(Boolean).join(' ') || 'N/A';
    const variables = {
      customer_name: loan.customer_name || 'Customer',
      vehicle,
      due_date: fmtDate(loan.due_date),
      overdue_days: String(calc.calendarDaysPastDue),
      penalty: fmtRupees(calc.netPenalty),
      penalty_per_day: fmtRupees(calc.penaltyPerDay),
      branch_phone: loan.branch_phone || 'N/A',
      company_name: loan.company_name || 'Our dealership',
    };
    const { rows: tpl } = await query(
      `SELECT template_body FROM whatsapp_templates
       WHERE company_id = $1 AND message_type = 'loan_overdue' AND is_active = TRUE`,
      [companyId],
    );
    const { buildMessage } = require('../services/whatsappService');
    const previewMessage = tpl.length ? buildMessage(tpl[0].template_body, variables) : '';
    res.json({
      previewMessage,
      customer_phone: loan.customer_phone,
      overdue_days: calc.calendarDaysPastDue,
      last_reminder_sent: loan.last_reminder_sent,
    });
  } catch (err) {
    console.error('previewLoanMessage:', err.message);
    res.status(500).json({ error: 'Failed to build preview' });
  }
}

async function sendLoanReminder(req, res) {
  try {
    const { loanId } = req.params;
    const companyId = req.user.company_id;

    const { rows } = await query(
      `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone,
              i.id AS invoice_id, v.make AS vehicle_make, v.model AS vehicle_model,
              v.chassis_number, b.phone AS branch_phone, co.name AS company_name
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       LEFT JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN branches b ON b.id = i.branch_id
       JOIN companies co ON co.id = l.company_id
       WHERE l.id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE`,
      [loanId, companyId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Loan not found' });
    const loan = rows[0];

    let phone = loan.customer_phone;
    if (req.body?.phone && String(req.body.phone).replace(/\D/g, '').length >= 10) {
      phone = req.body.phone;
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'Customer has no phone number on record' });
    }

    const calc = calculatePenalty(loan);
    const chassis = loan.chassis_number ? String(loan.chassis_number).slice(-6) : '';
    const vehicle = [loan.vehicle_make, loan.vehicle_model, chassis && `…${chassis}`].filter(Boolean).join(' ') || 'N/A';

    const variables = {
      customer_name: loan.customer_name || 'Customer',
      vehicle,
      due_date: fmtDate(loan.due_date),
      overdue_days: String(calc.calendarDaysPastDue),
      penalty: fmtRupees(calc.netPenalty),
      penalty_per_day: fmtRupees(calc.penaltyPerDay),
      branch_phone: loan.branch_phone || 'N/A',
      company_name: loan.company_name || 'Our dealership',
    };

    const bodyOverride = req.body?.message;
    let result;
    if (bodyOverride && String(bodyOverride).trim()) {
      result = await sendCustomMessage({
        companyId,
        recipientPhone: phone,
        recipientName: loan.customer_name,
        messageBody: String(bodyOverride).trim(),
        triggeredByUserId: req.user.id,
      });
    } else {
      result = await sendWhatsApp({
        companyId,
        recipientPhone: phone,
        recipientName: loan.customer_name,
        messageType: 'loan_overdue',
        referenceId: loanId,
        referenceType: 'loan',
        variables,
        triggeredByUserId: req.user.id,
      });
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    await query(
      `UPDATE loans SET last_reminder_sent = CURRENT_DATE, updated_at = NOW() WHERE id = $1`,
      [loanId],
    );

    res.json({ success: true, logId: result.logId, previewMessage: result.previewMessage });
  } catch (err) {
    console.error('sendLoanReminder:', err.message);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
}

async function listLogs(req, res) {
  try {
    const companyId = req.user.company_id;
    const { reference_id, type, from, to } = req.query;
    const cond = ['company_id = $1'];
    const params = [companyId];
    let i = 2;
    if (reference_id) {
      cond.push(`reference_id = $${i++}`);
      params.push(reference_id);
    }
    if (type) {
      cond.push(`message_type = $${i++}`);
      params.push(type);
    }
    if (from) {
      cond.push(`created_at >= $${i++}::timestamptz`);
      params.push(from);
    }
    if (to) {
      cond.push(`created_at <= $${i++}::timestamptz`);
      params.push(to);
    }
    const { rows } = await query(
      `SELECT wl.*, u.name AS user_name
       FROM whatsapp_logs wl
       LEFT JOIN users u ON u.id = wl.user_id
       WHERE ${cond.join(' AND ')}
       ORDER BY wl.created_at DESC
       LIMIT 500`,
      params,
    );
    res.json({ logs: rows });
  } catch (err) {
    console.error('listLogs whatsapp:', err.message);
    res.status(500).json({ error: 'Failed to load logs' });
  }
}

async function logsForInvoice(req, res) {
  try {
    const { invoiceId } = req.params;
    const companyId = req.user.company_id;
    const { role, branch_id: userBranch } = req.user;

    const { rows: inv } = await query(
      `SELECT branch_id FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [invoiceId, companyId],
    );
    if (inv.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    if (role === 'staff' || role === 'branch_manager') {
      if (String(inv[0].branch_id) !== String(userBranch)) {
        return res.status(403).json({ error: 'Not allowed' });
      }
    }

    const { rows } = await query(
      `SELECT * FROM whatsapp_logs
       WHERE company_id = $1 AND reference_type = 'invoice' AND reference_id = $2
       ORDER BY created_at DESC`,
      [companyId, invoiceId],
    );
    res.json({ logs: rows });
  } catch (err) {
    console.error('logsForInvoice:', err.message);
    res.status(500).json({ error: 'Failed to load logs' });
  }
}

async function listTemplates(req, res) {
  try {
    const { rows } = await query(
      `SELECT * FROM whatsapp_templates
       WHERE company_id = $1
       ORDER BY message_type`,
      [req.user.company_id],
    );
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load templates' });
  }
}

async function updateTemplate(req, res) {
  try {
    const { id } = req.params;
    const { template_body } = req.body || {};
    if (!template_body || !String(template_body).trim()) {
      return res.status(400).json({ error: 'template_body required' });
    }

    const { rows } = await query(
      `SELECT id, message_type FROM whatsapp_templates
       WHERE id = $1 AND company_id = $2`,
      [id, req.user.company_id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });

    const v = validateTemplatePlaceholders(rows[0].message_type, template_body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const u = await query(
      `UPDATE whatsapp_templates SET template_body = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [String(template_body).trim(), id, req.user.company_id],
    );
    res.json({ template: u.rows[0] });
  } catch (err) {
    console.error('updateTemplate:', err.message);
    res.status(500).json({ error: 'Failed to update template' });
  }
}

async function previewInvoiceMessage(req, res) {
  try {
    const { invoiceId } = req.params;
    const companyId = req.user.company_id;
    const data = await ic.fetchFullInvoice(invoiceId, companyId);
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    const inv = data.invoice;
    const vehicle = [inv.vehicle_make, inv.vehicle_model].filter(Boolean).join(' ') || 'N/A';
    const shareLink = generateShareLink('invoice', invoiceId, companyId);
    const variables = {
      customer_name: inv.customer_name || 'Customer',
      company_name: inv.company_name || 'Our dealership',
      invoice_number: inv.invoice_number,
      vehicle,
      amount: fmtRupees(inv.total),
      share_link: shareLink,
      branch_phone: inv.branch_phone || inv.company_phone || 'N/A',
    };
    const { rows: tpl } = await query(
      `SELECT template_body FROM whatsapp_templates
       WHERE company_id = $1 AND message_type = 'invoice_share' AND is_active = TRUE`,
      [companyId],
    );
    const { buildMessage } = require('../services/whatsappService');
    const previewMessage = tpl.length ? buildMessage(tpl[0].template_body, variables) : '';
    res.json({
      previewMessage,
      customer_phone: inv.customer_phone,
      customer_name: inv.customer_name,
    });
  } catch (err) {
    console.error('previewInvoiceMessage:', err.message);
    res.status(500).json({ error: 'Failed to build preview' });
  }
}

async function previewQuotationMessage(req, res) {
  try {
    const { quotationId } = req.params;
    const companyId = req.user.company_id;
    const bundle = await loadQuotationBundle(quotationId, companyId);
    if (!bundle || bundle.quotation.is_deleted) {
      return res.status(404).json({ error: 'Quotation not found' });
    }
    const qrow = bundle.quotation;
    const phone = qrow.customer_phone_override || bundle.customer?.phone;
    const custName = qrow.customer_name_override || bundle.customer?.name || 'Customer';
    const vehicle = [qrow.vehicle_make, qrow.vehicle_model].filter(Boolean).join(' ') || 'N/A';
    const shareLink = generateShareLink('quotation', quotationId, companyId);
    const { rows: co } = await query(`SELECT name, phone FROM companies WHERE id = $1`, [companyId]);
    const { rows: br } = await query(`SELECT phone FROM branches WHERE id = $1`, [qrow.branch_id]);
    const variables = {
      customer_name: custName,
      company_name: co[0]?.name || 'Our dealership',
      quotation_number: qrow.quotation_number,
      vehicle,
      amount: fmtRupees(qrow.total),
      valid_until: fmtDate(qrow.valid_until_date),
      share_link: shareLink,
      branch_phone: br[0]?.phone || co[0]?.phone || 'N/A',
    };
    const { rows: tpl } = await query(
      `SELECT template_body FROM whatsapp_templates
       WHERE company_id = $1 AND message_type = 'quotation_share' AND is_active = TRUE`,
      [companyId],
    );
    const { buildMessage } = require('../services/whatsappService');
    const previewMessage = tpl.length ? buildMessage(tpl[0].template_body, variables) : '';
    res.json({ previewMessage, customer_phone: phone, customer_name: custName });
  } catch (err) {
    console.error('previewQuotationMessage:', err.message);
    res.status(500).json({ error: 'Failed to build preview' });
  }
}

module.exports = {
  sendInvoiceWhatsApp,
  sendQuotationWhatsApp,
  sendCustom,
  previewLoanMessage,
  sendLoanReminder,
  listLogs,
  logsForInvoice,
  listTemplates,
  updateTemplate,
  previewInvoiceMessage,
  previewQuotationMessage,
};
