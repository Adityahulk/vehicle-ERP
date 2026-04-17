const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** Keep wa.me URLs under typical browser limits */
const WHATSAPP_URL_TEXT_MAX = 1800;

const ALL_KNOWN_KEYS = new Set([
  'customer_name', 'vehicle', 'amount', 'due_date', 'overdue_days', 'penalty', 'penalty_per_day',
  'invoice_number', 'quotation_number', 'share_link', 'pdf_link', 'valid_until', 'branch_phone', 'company_name',
]);

/**
 * Replace {placeholder} in template; missing values → N/A
 */
function buildMessage(templateBody, variables = {}) {
  if (!templateBody) return '';
  const vars = { ...variables };
  return templateBody.replace(PLACEHOLDER_RE, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null || String(v).trim() === '') return 'N/A';
    return String(v);
  });
}

/**
 * Normalize to 10-digit Indian mobile; returns null if invalid.
 */
function normalizeIndianMobile(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  if (d.length !== 10 || !/^\d{10}$/.test(d)) return null;
  return d;
}

function shareSecret() {
  return process.env.SHARE_SECRET || process.env.JWT_SECRET || 'change-me-share';
}

function publicBaseUrl() {
  const u = process.env.PUBLIC_APP_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
  return String(u).replace(/\/$/, '');
}

/**
 * JWT share link for invoice or quotation (7d).
 */
function generateShareLink(type, id, companyId) {
  const token = jwt.sign(
    { id, type, companyId },
    shareSecret(),
    { expiresIn: '7d' },
  );
  const path = type === 'invoice'
    ? `/api/share/invoice/${id}?token=${encodeURIComponent(token)}`
    : `/api/share/quotation/${id}?token=${encodeURIComponent(token)}`;
  return `${publicBaseUrl()}${path}`;
}

function generateSharePdfLink(type, id, companyId) {
  const token = jwt.sign(
    { id, type, companyId },
    shareSecret(),
    { expiresIn: '7d' },
  );
  const path = type === 'invoice'
    ? `/api/share/invoice/${id}/pdf?token=${encodeURIComponent(token)}`
    : `/api/share/quotation/${id}/pdf?token=${encodeURIComponent(token)}`;
  return `${publicBaseUrl()}${path}`;
}

/**
 * Opens WhatsApp (app or web) with prefilled text. Attachments are not supported via URL;
 * include PDF/share links inside the message body.
 * @returns {string|null} https://wa.me/91XXXXXXXXXX?text=...
 */
function buildWhatsAppOpenUrl(digits10, messageText) {
  const d = String(digits10 || '').replace(/\D/g, '');
  const n = d.length === 10 ? d : '';
  if (!n) return null;
  let t = String(messageText || '');
  if (t.length > WHATSAPP_URL_TEXT_MAX) {
    t = `${t.slice(0, WHATSAPP_URL_TEXT_MAX - 30)}\n…(message truncated — edit in WhatsApp if needed)`;
  }
  return `https://wa.me/91${n}?text=${encodeURIComponent(t)}`;
}

/**
 * Build message from DB template (no network send).
 */
async function composeTemplatedMessage({
  companyId,
  messageType,
  variables,
}) {
  const { rows: tplRows } = await query(
    `SELECT template_body FROM whatsapp_templates
     WHERE company_id = $1 AND message_type = $2 AND is_active = TRUE`,
    [companyId, messageType],
  );
  if (tplRows.length === 0) {
    return { success: false, error: `No active template for message type: ${messageType}` };
  }
  const text = buildMessage(tplRows[0].template_body, variables);
  return { success: true, message: text };
}

/**
 * Custom body only (no DB template).
 */
function composeCustomMessageBody(messageBody) {
  const t = String(messageBody || '').trim();
  if (!t) return { success: false, error: 'Message is empty' };
  return { success: true, message: t };
}

function extractPlaceholders(body) {
  const set = new Set();
  let m;
  const re = /\{(\w+)\}/g;
  while ((m = re.exec(body)) !== null) {
    if (ALL_KNOWN_KEYS.has(m[1])) set.add(m[1]);
  }
  return set;
}

const REQUIRED_BY_TYPE = {
  loan_overdue: ['customer_name', 'vehicle', 'due_date', 'overdue_days', 'penalty', 'branch_phone', 'company_name'],
  loan_due_soon: ['customer_name', 'vehicle', 'due_date', 'branch_phone', 'company_name'],
  invoice_share: ['customer_name', 'company_name', 'invoice_number', 'vehicle', 'amount', 'share_link', 'branch_phone'],
  quotation_share: ['customer_name', 'company_name', 'quotation_number', 'vehicle', 'amount', 'valid_until', 'share_link', 'branch_phone'],
  loan_penalty_alert: ['customer_name', 'vehicle', 'due_date', 'overdue_days', 'penalty_per_day', 'penalty', 'branch_phone', 'company_name'],
};

function validateTemplatePlaceholders(messageType, newBody) {
  const required = REQUIRED_BY_TYPE[messageType];
  if (!required) return { ok: true };
  const present = extractPlaceholders(newBody);
  const missing = required.filter((k) => !present.has(k));
  if (missing.length) {
    return { ok: false, error: `Template must include placeholders: ${missing.map((k) => `{${k}}`).join(', ')}` };
  }
  return { ok: true };
}

module.exports = {
  buildMessage,
  normalizeIndianMobile,
  generateShareLink,
  generateSharePdfLink,
  buildWhatsAppOpenUrl,
  composeTemplatedMessage,
  composeCustomMessageBody,
  validateTemplatePlaceholders,
  shareSecret,
  publicBaseUrl,
};
