const TEMPLATES = {
  LOAN_OVERDUE: ({ name, chassis, days, penalty, branch_phone }) =>
    `Dear ${name}, your loan for vehicle ${chassis} is overdue by ${days} days. ` +
    `Penalty accrued: Rs.${penalty}. Please contact ${branch_phone}.`,

  INSURANCE_EXPIRY: ({ name, chassis, date }) =>
    `Dear ${name}, insurance for your vehicle ${chassis} expires on ${date}. ` +
    `Contact us to renew.`,

  SERVICE_REMINDER: ({ name, make, model, chassis, branch_phone }) =>
    `Dear ${name}, your ${make} ${model} (${chassis}) is due for service. ` +
    `Contact ${branch_phone}.`,
};

function formatPhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 10) return `+91${cleaned}`;
  return `+${cleaned}`;
}

/**
 * Send WhatsApp message via Twilio.
 * Returns { success, sid? } or { success: false, reason }.
 */
async function sendWhatsApp(phone, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;

  const to = formatPhone(phone);
  if (!accountSid || !authToken || !fromNumber || !to) {
    console.log(`[Notification] WhatsApp skipped — missing config or phone`);
    return { success: false, reason: 'missing_config' };
  }

  try {
    const twilio = require('twilio')(accountSid, authToken);
    const result = await twilio.messages.create({
      body: message,
      from: `whatsapp:${fromNumber}`,
      to: `whatsapp:${to}`,
    });
    console.log(`[Notification] WhatsApp sent to ${to} — SID: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error(`[Notification] WhatsApp failed for ${to}:`, err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Send SMS via 2Factor API (or Fast2SMS as fallback).
 * Returns { success, ... } or { success: false, reason }.
 */
async function sendSMS(phone, message) {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const to = formatPhone(phone);

  if (!apiKey || !to) {
    console.log(`[Notification] SMS skipped — missing config or phone`);
    return { success: false, reason: 'missing_config' };
  }

  try {
    const cleanNumber = to.replace('+', '');
    const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/TSMS`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: 'VHLERP',
        To: cleanNumber,
        Msg: message,
      }),
    });

    const data = await response.json();
    if (data.Status === 'Success') {
      console.log(`[Notification] SMS sent to ${cleanNumber}`);
      return { success: true, details: data.Details };
    }
    console.error(`[Notification] SMS API returned:`, data);
    return { success: false, reason: data.Details || 'API error' };
  } catch (err) {
    console.error(`[Notification] SMS failed for ${to}:`, err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Send a notification using a template. Tries WhatsApp first, then SMS fallback.
 */
async function sendTemplatedNotification(templateKey, params, phone) {
  const templateFn = TEMPLATES[templateKey];
  if (!templateFn) {
    console.error(`[Notification] Unknown template: ${templateKey}`);
    return { success: false, reason: 'unknown_template' };
  }

  const message = templateFn(params);

  // Try WhatsApp first
  const waResult = await sendWhatsApp(phone, message);
  if (waResult.success) return { ...waResult, channel: 'whatsapp' };

  // Fallback to SMS
  const smsResult = await sendSMS(phone, message);
  return { ...smsResult, channel: 'sms' };
}

module.exports = {
  TEMPLATES,
  sendWhatsApp,
  sendSMS,
  sendTemplatedNotification,
  formatPhone,
};
