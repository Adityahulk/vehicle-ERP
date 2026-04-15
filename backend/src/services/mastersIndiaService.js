/**
 * Masters India E-Invoice (IRN) & E-Way Bill REST integration
 * Docs: https://docs.mastersindia.co/einvoicing
 *
 * Auth: API key header `api_key`, or username/password → POST /api/v1/token-auth/
 * then `Authorization: JWT <token>` on subsequent calls.
 */

const SANDBOX_API_BASE = 'https://sandb-api.mastersindia.co';
const PRODUCTION_API_BASE = 'https://router.mastersindia.co';

const redis = require('../config/redis');

let tokenCache = { token: null, expiry: 0 };
const REDIS_TOKEN_KEY = 'masters_india_auth_token';
const REDIS_EXPIRY_KEY = 'masters_india_auth_token_expiry';

function getConfig() {
  const isProduction = process.env.MASTERS_INDIA_ENV === 'production';
  return {
    apiBaseUrl: isProduction ? PRODUCTION_API_BASE : SANDBOX_API_BASE,
    username: process.env.MASTERS_INDIA_USERNAME || '',
    password: process.env.MASTERS_INDIA_PASSWORD || '',
    apiKey: process.env.MASTERS_INDIA_API_KEY || '',
    isProduction,
  };
}

function isMastersIndiaEnabled() {
  const c = getConfig();
  return !!(c.apiKey || (c.username && c.password));
}

function toRupees(paise) {
  return Math.round(Number(paise)) / 100;
}

function extractPin(address) {
  if (!address) return 0;
  const match = String(address).match(/\b(\d{6})\b/);
  return match ? parseInt(match[1], 10) : 0;
}

function formatDateDdMmYyyy(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseMastersError(data) {
  const r = data?.results;
  if (typeof r?.message === 'string' && r.message) return r.message;
  if (r?.errorMessage) return r.errorMessage;
  if (typeof data?.error === 'string') return data.error;
  try {
    return JSON.stringify(data);
  } catch {
    return 'Unknown Masters India API error';
  }
}

function isMastersSuccess(data) {
  return data?.results?.status === 'Success' && Number(data?.results?.code) === 200;
}

async function getAuthToken() {
  const config = getConfig();
  const now = Date.now();

  if (config.apiKey) {
    throw new Error('getAuthToken should not be called when api_key auth is configured');
  }

  if (tokenCache.token && tokenCache.expiry > now + 1200000) {
    return tokenCache.token;
  }

  try {
    const [cachedToken, cachedExpiry] = await Promise.all([
      redis.get(REDIS_TOKEN_KEY),
      redis.get(REDIS_EXPIRY_KEY),
    ]);
    if (cachedToken && Number(cachedExpiry) > now + 1200000) {
      tokenCache = { token: cachedToken, expiry: Number(cachedExpiry) };
      return cachedToken;
    }
  } catch (err) {
    console.warn('Redis cache read failed (mastersIndiaService):', err.message);
  }

  const response = await fetch(`${config.apiBaseUrl}/api/v1/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseMastersError(data) || `Login failed (${response.status})`);
  }

  const token = data.token || data.results?.token || data.results?.message?.token;
  if (!token) {
    throw new Error('Masters India login did not return a token');
  }

  const expiry = now + 23 * 60 * 60 * 1000;
  tokenCache = { token, expiry };

  try {
    const ttlSec = 23 * 60 * 60;
    await Promise.all([
      redis.set(REDIS_TOKEN_KEY, token, 'EX', ttlSec),
      redis.set(REDIS_EXPIRY_KEY, String(expiry), 'EX', ttlSec),
    ]);
  } catch (redisErr) {
    console.warn('Redis cache write failed (mastersIndiaService):', redisErr.message);
  }

  return token;
}

async function getAuthHeaders() {
  const config = getConfig();
  if (config.apiKey) {
    return {
      'Content-Type': 'application/json',
      api_key: config.apiKey,
    };
  }
  const token = await getAuthToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `JWT ${token}`,
  };
}

async function mastersPost(path, body) {
  const config = getConfig();
  const headers = await getAuthHeaders();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/**
 * Build Masters India /api/v1/einvoice/ JSON body from invoice + line items.
 * @param {{ invoice: object, items: object[] }} invoiceData
 * @param {string} userGstin Seller GSTIN (companies.gstin)
 */
function buildEInvoiceBody(invoiceData, userGstin) {
  const { invoice: inv, items } = invoiceData;

  const sellerStateCode = inv.company_gstin ? String(inv.company_gstin).substring(0, 2) : '09';
  const buyerStateCode = inv.customer_gstin && inv.customer_gstin !== 'URP'
    ? String(inv.customer_gstin).substring(0, 2)
    : sellerStateCode;

  let documentType = 'INV';
  if (inv.invoice_number?.startsWith('CN-')) documentType = 'CRN';
  if (inv.invoice_number?.startsWith('DN-')) documentType = 'DBN';

  const itemList = (items || []).map((item, idx) => {
    const unitPrice = toRupees(item.unit_price);
    const qty = Number(item.quantity) || 1;
    const totAmt = Math.round(unitPrice * qty * 100) / 100;
    const discount = 0;
    const assAmt = Math.round((totAmt - discount) * 100) / 100;
    const cgstAmt = toRupees(item.cgst_amount);
    const sgstAmt = toRupees(item.sgst_amount);
    const igstAmt = toRupees(item.igst_amount);
    const gstRate = Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0) + Number(item.igst_rate || 0);
    const totalItemVal = Math.round((assAmt + cgstAmt + sgstAmt + igstAmt) * 100) / 100;

    return {
      item_serial_number: String(idx + 1),
      product_description: item.description || 'Item',
      is_service: 'N',
      hsn_code: item.hsn_code || '8703',
      bar_code: '',
      quantity: qty,
      free_quantity: 0,
      unit: 'NOS',
      unit_price: unitPrice,
      total_amount: totAmt,
      pre_tax_value: 0,
      discount,
      other_charge: 0,
      assessable_value: assAmt,
      gst_rate: gstRate,
      igst_amount: igstAmt,
      cgst_amount: cgstAmt,
      sgst_amount: sgstAmt,
      cess_rate: 0,
      cess_amount: 0,
      cess_nonadvol_amount: 0,
      state_cess_rate: 0,
      state_cess_amount: 0,
      state_cess_nonadvol_amount: 0,
      total_item_value: totalItemVal,
      country_origin: '',
      order_line_reference: '',
      product_serial_number: '',
    };
  });

  const totalAssVal = itemList.reduce((s, i) => s + i.assessable_value, 0);
  const totalCgst = itemList.reduce((s, i) => s + i.cgst_amount, 0);
  const totalSgst = itemList.reduce((s, i) => s + i.sgst_amount, 0);
  const totalIgst = itemList.reduce((s, i) => s + i.igst_amount, 0);
  const discount = toRupees(inv.discount || 0);
  const totalInvVal = Math.round((totalAssVal + totalCgst + totalSgst + totalIgst - discount) * 100) / 100;

  const sellerPin = extractPin(inv.company_address) || 201301;
  const buyerPin = extractPin(inv.customer_address) || sellerPin;

  const buyerGstin = inv.customer_gstin && String(inv.customer_gstin).trim()
    ? String(inv.customer_gstin).trim()
    : 'URP';

  return {
    user_gstin: userGstin,
    data_source: 'erp',
    transaction_details: {
      supply_type: 'B2B',
      charge_type: 'N',
      igst_on_intra: 'N',
      ecommerce_gstin: '',
    },
    document_details: {
      document_type: documentType,
      document_number: inv.invoice_number,
      document_date: formatDateDdMmYyyy(inv.invoice_date),
    },
    seller_details: {
      gstin: inv.company_gstin || userGstin,
      legal_name: inv.company_name || 'Seller',
      trade_name: inv.company_name || 'Seller',
      address1: (inv.company_address || 'Address').substring(0, 100),
      address2: '',
      location: (inv.company_address || '').split(',').pop()?.trim()?.replace(/\d{6}/, '').trim() || 'City',
      pincode: sellerPin,
      state_code: sellerStateCode,
      phone_number: String((inv.company_phone || '').replace(/\D/g, '').substring(0, 12) || '9999999999'),
      email: inv.company_email || '',
    },
    buyer_details: {
      gstin: buyerGstin,
      legal_name: inv.customer_name || 'Buyer',
      trade_name: inv.customer_name || 'Buyer',
      address1: (inv.customer_address || 'Address').substring(0, 100),
      address2: '',
      location: (inv.customer_address || '').split(',').pop()?.trim()?.replace(/\d{6}/, '').trim() || 'City',
      pincode: buyerPin,
      place_of_supply: buyerStateCode,
      state_code: buyerStateCode,
      phone_number: String((inv.customer_phone || '').replace(/\D/g, '').substring(0, 12) || '9999999999'),
      email: inv.customer_email || '',
    },
    value_details: {
      total_assessable_value: Math.round(totalAssVal * 100) / 100,
      total_cgst_value: Math.round(totalCgst * 100) / 100,
      total_sgst_value: Math.round(totalSgst * 100) / 100,
      total_igst_value: Math.round(totalIgst * 100) / 100,
      total_cess_value: 0,
      total_cess_value_of_state: 0,
      total_discount: Math.round(discount * 100) / 100,
      total_other_charge: 0,
      total_invoice_value: totalInvVal,
      round_off_amount: 0,
      total_invoice_value_additional_currency: 0,
    },
    item_list: itemList,
  };
}

async function generateIRN(_companyId, invoiceData) {
  const inv = invoiceData.invoice;
  const userGstin = inv.company_gstin || '';
  if (!userGstin) {
    throw new Error('Company GSTIN is required for e-invoice (set on company profile)');
  }

  const body = buildEInvoiceBody(invoiceData, userGstin);
  const { response, data } = await mastersPost('/api/v1/einvoice/', body);

  if (!response.ok || !isMastersSuccess(data)) {
    throw new Error(`Masters India IRN generation failed: ${parseMastersError(data)}`);
  }

  const msg = data.results.message;
  return {
    irn: msg.Irn,
    ackNumber: msg.AckNo != null ? String(msg.AckNo) : '',
    ackDate: msg.AckDt || '',
    signedQr: msg.SignedQRCode || '',
    signedInvoice: msg.SignedInvoice || '',
  };
}

async function cancelIRN(_companyId, irn, reason, remark, userGstin) {
  if (!userGstin) {
    throw new Error('Company GSTIN is required to cancel IRN');
  }

  const body = {
    user_gstin: userGstin,
    irn,
    cancel_reason: reason != null && String(reason).trim() !== '' ? String(reason) : '2',
    cancel_remarks: remark || 'Data entry mistake',
    ewaybill_cancel: '',
  };

  const { response, data } = await mastersPost('/api/v1/cancel-einvoice/', body);

  if (!response.ok || !isMastersSuccess(data)) {
    throw new Error(`Masters India IRN cancellation failed: ${parseMastersError(data)}`);
  }

  return {
    cancelled: true,
    cancelDate: data.results.message?.CancelDate || new Date().toISOString(),
  };
}

function normalizeTransDocDate(dt) {
  if (!dt) return formatDateDdMmYyyy(new Date());
  if (typeof dt === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dt)) return dt;
  return formatDateDdMmYyyy(dt);
}

async function generateEwayBill(_companyId, irn, transportArgs, userGstin) {
  if (!irn) throw new Error('IRN is required to generate E-Way Bill');
  if (!userGstin) throw new Error('Company GSTIN is required for e-way bill');

  const body = {
    user_gstin: userGstin,
    irn,
    transporter_id: transportArgs.transporter_id || '',
    transportation_mode: String(transportArgs.transport_mode || '1'),
    transporter_document_number: transportArgs.trans_doc_no || '1',
    transporter_document_date: normalizeTransDocDate(transportArgs.trans_doc_dt),
    vehicle_number: (transportArgs.vehicle_no || '').replace(/\s/g, '').toUpperCase(),
    distance: Number(transportArgs.distance_km) || 0,
    vehicle_type: transportArgs.vehicle_type || 'R',
    transporter_name: transportArgs.transporter_name || '',
    data_source: 'erp',
  };

  const { response, data } = await mastersPost('/api/v1/gen-ewb-by-irn/', body);

  if (!response.ok || !isMastersSuccess(data)) {
    throw new Error(`Masters India E-Way Bill generation failed: ${parseMastersError(data)}`);
  }

  const msg = data.results.message;
  return {
    ewbNo: msg.EwbNo,
    ewbDt: msg.EwbDt,
    validUpto: msg.EwbValidTill,
  };
}

function mapEwayCancelReason(reason) {
  if (reason == null || reason === '') return 'Others';
  const s = String(reason);
  if (/^\d+$/.test(s)) {
    const codes = {
      1: 'Duplicate',
      2: 'Order Cancelled',
      3: 'Data Entry Mistake',
      4: 'Others',
    };
    return codes[Number(s)] || 'Others';
  }
  return s;
}

async function cancelEwayBill(_companyId, ewbNo, reason, remark, userGstin) {
  if (!userGstin) {
    throw new Error('Company GSTIN is required to cancel e-way bill');
  }

  const body = {
    userGstin,
    eway_bill_number: typeof ewbNo === 'string' && /^\d+$/.test(ewbNo.trim())
      ? parseInt(ewbNo.trim(), 10)
      : Number(ewbNo),
    reason_of_cancel: mapEwayCancelReason(reason),
    cancel_remark: remark || 'Cancelled',
    data_source: 'erp',
  };

  const { response, data } = await mastersPost('/api/v1/ewayBillCancel/', body);

  if (!response.ok || !isMastersSuccess(data)) {
    throw new Error(`Masters India E-Way Bill cancellation failed: ${parseMastersError(data)}`);
  }

  return {
    cancelled: true,
    cancelDate: data.results.message?.cancelDate || new Date().toISOString(),
  };
}

module.exports = {
  generateIRN,
  cancelIRN,
  generateEwayBill,
  cancelEwayBill,
  buildEInvoiceBody,
  isMastersIndiaEnabled,
};
