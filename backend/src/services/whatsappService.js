const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const PLACEHOLDER_RE = /\{(\w+)\}/g;

const ALL_KNOWN_KEYS = new Set([
  'customer_name', 'vehicle', 'amount', 'due_date', 'overdue_days', 'penalty', 'penalty_per_day',
  'invoice_number', 'quotation_number', 'share_link', 'valid_until', 'branch_phone', 'company_name',
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

async function sendViaProvider(toDigits10, messageText) {
  const provider = (process.env.WHATSAPP_PROVIDER || 'mock').toLowerCase();

  if (provider === 'mock') {
    console.log('[WhatsApp MOCK] To:', toDigits10, 'Message:', messageText.slice(0, 120) + (messageText.length > 120 ? '…' : ''));
    return { success: true, provider_message_id: `mock_${Date.now()}` };
  }

  if (provider === 'waba') {
    return { success: false, error: 'WhatsApp Business API (waba) is not implemented yet' };
  }

  if (provider !== 'twilio') {
    return { success: false, error: `Unknown WHATSAPP_PROVIDER: ${provider}` };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER;
  if (!accountSid || !authToken || !fromRaw) {
    return { success: false, error: 'Twilio WhatsApp env vars missing' };
  }

  const fromNorm = String(fromRaw).replace(/^whatsapp:/i, '').trim();
  const toWa = `whatsapp:+91${toDigits10}`;

  try {
    const twilio = require('twilio')(accountSid, authToken);
    const result = await twilio.messages.create({
      body: messageText,
      from: fromNorm.startsWith('+') ? `whatsapp:${fromNorm}` : `whatsapp:+${fromNorm.replace(/^\+/, '')}`,
      to: toWa,
    });
    return { success: true, provider_message_id: result.sid };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Send templated WhatsApp, log row, return { success, logId?, error? }
 */
async function sendWhatsApp({
  companyId,
  recipientPhone,
  recipientName,
  messageType,
  referenceId = null,
  referenceType = null,
  variables = {},
  triggeredByUserId = null,
}) {
  const mobile = normalizeIndianMobile(recipientPhone);
  if (!mobile) {
    console.error('[WhatsApp] Invalid phone:', recipientPhone);
    return { success: false, error: 'Invalid phone number' };
  }

  const { rows: tplRows } = await query(
    `SELECT id, template_body FROM whatsapp_templates
     WHERE company_id = $1 AND message_type = $2 AND is_active = TRUE`,
    [companyId, messageType],
  );
  if (tplRows.length === 0) {
    return { success: false, error: `No active template for message type: ${messageType}` };
  }

  const text = buildMessage(tplRows[0].template_body, variables);
  const prov = await sendViaProvider(mobile, text);
  const status = prov.success ? 'sent' : 'failed';
  const now = new Date().toISOString();

  const { rows: logRows } = await query(
    `INSERT INTO whatsapp_logs (
       company_id, user_id, recipient_phone, recipient_name, message_type,
       reference_id, reference_type, message_body, status,
       provider_message_id, error_message, sent_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      companyId,
      triggeredByUserId || null,
      `+91${mobile}`,
      recipientName || null,
      messageType,
      referenceId,
      referenceType,
      text,
      status,
      prov.provider_message_id || null,
      prov.success ? null : (prov.error || 'send failed'),
      prov.success ? now : null,
    ],
  );

  return {
    success: prov.success,
    logId: logRows[0]?.id,
    error: prov.success ? undefined : prov.error,
    previewMessage: text,
  };
}

/**
 * Simple send without DB template (custom / internal).
 */
async function sendCustomMessage({
  companyId,
  recipientPhone,
  recipientName,
  messageBody,
  triggeredByUserId = null,
}) {
  const mobile = normalizeIndianMobile(recipientPhone);
  if (!mobile) {
    return { success: false, error: 'Invalid phone number' };
  }
  const prov = await sendViaProvider(mobile, messageBody);
  const now = new Date().toISOString();
  const status = prov.success ? 'sent' : 'failed';
  const { rows: logRows } = await query(
    `INSERT INTO whatsapp_logs (
       company_id, user_id, recipient_phone, recipient_name, message_type,
       reference_id, reference_type, message_body, status,
       provider_message_id, error_message, sent_at
     ) VALUES ($1,$2,$3,$4,'custom',NULL,NULL,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      companyId,
      triggeredByUserId || null,
      `+91${mobile}`,
      recipientName || null,
      messageBody,
      status,
      prov.provider_message_id || null,
      prov.success ? null : (prov.error || 'send failed'),
      prov.success ? now : null,
    ],
  );
  return { success: prov.success, logId: logRows[0]?.id, error: prov.error };
}

async function sendBulkWhatsApp(messages) {
  let sent = 0;
  let failed = 0;
  const errors = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const r = await sendWhatsApp(m);
    if (r.success) sent += 1;
    else {
      failed += 1;
      errors.push({ index: i, error: r.error });
    }
    if (i < messages.length - 1) {
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return { sent, failed, errors };
}

/** Raw Twilio/mock send for legacy callers (no template log). */
async function sendRawWhatsApp(phone, message) {
  const mobile = normalizeIndianMobile(phone);
  if (!mobile) return { success: false, reason: 'invalid_phone' };
  const prov = await sendViaProvider(mobile, message);
  return prov.success
    ? { success: true, sid: prov.provider_message_id }
    : { success: false, reason: prov.error };
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
  sendWhatsApp,
  sendCustomMessage,
  sendBulkWhatsApp,
  sendRawWhatsApp,
  extractPlaceholders,
  validateTemplatePlaceholders,
  REQUIRED_BY_TYPE,
  shareSecret,
  publicBaseUrl,
};
