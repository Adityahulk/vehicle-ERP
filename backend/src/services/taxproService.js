/**
 * Taxpro GSP E-Invoice & E-Way Bill Integration Service
 * API Docs: http://help.taxprogsp.co.in/ucl
 *
 * This service implements the standard NIC-compliant IRN and EBS generation.
 * Authentication logic includes automated token caching and refresh to minimize user disturbance.
 */

const SANDBOX_BASE = 'https://sandbox.taxprogsp.co.in'; // Placeholder, update once registration is complete
const PROD_BASE = 'https://api.taxprogsp.co.in';      // Placeholder, update once registration is complete

const redis = require('../config/redis');

// ─── Token Cache ─────────────────────────────────────────────
let tokenCache = {
  token: null,
  expiry: 0,
};

const REDIS_TOKEN_KEY = 'taxpro_auth_token';
const REDIS_EXPIRY_KEY = 'taxpro_auth_token_expiry';

// ─── Config ──────────────────────────────────────────────────

function getConfig() {
  const isProduction = process.env.TAXPRO_ENV === 'production';
  return {
    baseUrl: isProduction ? PROD_BASE : SANDBOX_BASE,
    clientId: process.env.TAXPRO_CLIENT_ID || '',
    clientSecret: process.env.TAXPRO_CLIENT_SECRET || '',
    username: process.env.TAXPRO_USERNAME || '',
    password: process.env.TAXPRO_PASSWORD || '',
    gstin: process.env.TAXPRO_GSTIN || '',
    isProduction,
  };
}

function isTaxproEnabled() {
  return !!(
    process.env.TAXPRO_CLIENT_ID &&
    process.env.TAXPRO_USERNAME &&
    process.env.TAXPRO_PASSWORD &&
    process.env.TAXPRO_GSTIN
  );
}

// ─── Authentication ──────────────────────────────────────────

async function getAuthToken() {
  const config = getConfig();
  const now = Date.now();

  // 1. Try Memory Cache (with 20-minute buffer)
  if (tokenCache.token && tokenCache.expiry > now + 1200000) {
    return tokenCache.token;
  }

  // 2. Try Redis Cache
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
    console.warn('Redis Cache Retrieval failed in TaxproService:', err.message);
  }

  // 3. Login to Taxpro
  try {
    const response = await fetch(`${config.baseUrl}/api/Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ClientId: config.clientId,
        ClientSecret: config.clientSecret,
        UserName: config.username,
        Password: config.password,
        Gstin: config.gstin,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.ErrorDetails?.[0]?.ErrorMessage || data?.Message || 'Authentication failed');
    }

    const token = data.Token;
    const expiry = new Date(data.TokenExpiry).getTime() || (now + 6 * 60 * 60 * 1000);

    // Save to Memory
    tokenCache = { token, expiry };

    // Save to Redis (survives app restarts)
    try {
      const ttlSec = Math.floor((expiry - now) / 1000);
      if (ttlSec > 0) {
        await Promise.all([
          redis.set(REDIS_TOKEN_KEY, token, 'EX', ttlSec),
          redis.set(REDIS_EXPIRY_KEY, expiry.toString(), 'EX', ttlSec),
        ]);
      }
    } catch (redisErr) {
      console.warn('Redis Cache Storage failed in TaxproService:', redisErr.message);
    }

    return token;
  } catch (err) {
    console.error('Taxpro Authentication Error:', err.message);
    throw new Error(`Taxpro Login Failed: ${err.message}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────

async function getHeaders() {
  const config = getConfig();
  const token = await getAuthToken();
  return {
    'Content-Type': 'application/json',
    'Token': token,
    'Gstin': config.gstin,
  };
}

function toRupees(paise) {
  return Math.round(Number(paise)) / 100;
}

function extractPin(address) {
  if (!address) return 0;
  const match = address.match(/\b(\d{6})\b/);
  return match ? parseInt(match[1], 10) : 0;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ─── Build NIC-compliant e-Invoice payload ───────────────────
// Same INV-01 standard schema used previously
function buildEInvoicePayload(invoiceData) {
  const { invoice: inv, items } = invoiceData;

  const hasIgst = items.some((i) => Number(i.igst_amount) > 0);
  const supTyp = hasIgst ? 'INTRSUP' : 'B2B';

  let docTyp = 'INV';
  if (inv.invoice_number?.startsWith('CN-')) docTyp = 'CRN';
  if (inv.invoice_number?.startsWith('DN-')) docTyp = 'DBN';

  const sellerStateCode = inv.company_gstin ? inv.company_gstin.substring(0, 2) : '30';
  const buyerStateCode = inv.customer_gstin ? inv.customer_gstin.substring(0, 2) : sellerStateCode;

  const itemList = items.map((item, idx) => {
    const unitPrice = toRupees(item.unit_price);
    const qty = Number(item.quantity) || 1;
    const totAmt = unitPrice * qty;
    const discount = 0;
    const assAmt = totAmt - discount;
    const cgstAmt = toRupees(item.cgst_amount);
    const sgstAmt = toRupees(item.sgst_amount);
    const igstAmt = toRupees(item.igst_amount);
    const totalItemVal = assAmt + cgstAmt + sgstAmt + igstAmt;

    return {
      SlNo: String(idx + 1),
      PrdDesc: item.description || 'Vehicle',
      IsServc: 'N',
      HsnCd: item.hsn_code || '8703',
      Qty: qty,
      FreeQty: 0,
      Unit: 'NOS',
      UnitPrice: unitPrice,
      TotAmt: totAmt,
      Discount: discount,
      PreTaxVal: 0,
      AssAmt: assAmt,
      GstRt: Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0) + Number(item.igst_rate || 0),
      IgstAmt: igstAmt,
      CgstAmt: cgstAmt,
      SgstAmt: sgstAmt,
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: totalItemVal,
    };
  });

  const totalAssVal = itemList.reduce((s, i) => s + i.AssAmt, 0);
  const totalCgst = itemList.reduce((s, i) => s + i.CgstAmt, 0);
  const totalSgst = itemList.reduce((s, i) => s + i.SgstAmt, 0);
  const totalIgst = itemList.reduce((s, i) => s + i.IgstAmt, 0);
  const discount = toRupees(inv.discount || 0);
  const totalInvVal = totalAssVal + totalCgst + totalSgst + totalIgst - discount;

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: supTyp,
      RegRev: 'N',
      EcmGstin: null,
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: docTyp,
      No: inv.invoice_number,
      Dt: formatDate(inv.invoice_date),
    },
    SellerDtls: {
      Gstin: inv.company_gstin || '',
      LglNm: inv.company_name || '',
      TrdNm: inv.company_name || '',
      Addr1: (inv.company_address || '').substring(0, 100) || 'Address',
      Addr2: '',
      Loc: (inv.company_address || '').split(',').pop()?.trim()?.replace(/\d{6}/, '').trim() || 'City',
      Pin: extractPin(inv.company_address) || 403001,
      Stcd: sellerStateCode,
      Ph: (inv.company_phone || '').replace(/\D/g, '').substring(0, 12) || null,
      Em: inv.company_email || null,
    },
    BuyerDtls: {
      Gstin: inv.customer_gstin || 'URP',
      LglNm: inv.customer_name || '',
      TrdNm: inv.customer_name || '',
      Pos: buyerStateCode,
      Addr1: (inv.customer_address || '').substring(0, 100) || 'Address',
      Addr2: '',
      Loc: (inv.customer_address || '').split(',').pop()?.trim()?.replace(/\d{6}/, '').trim() || 'City',
      Pin: extractPin(inv.customer_address) || 403001,
      Stcd: buyerStateCode,
      Ph: (inv.customer_phone || '').replace(/\D/g, '').substring(0, 12) || null,
      Em: inv.customer_email || null,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: Math.round(totalAssVal * 100) / 100,
      CgstVal: Math.round(totalCgst * 100) / 100,
      SgstVal: Math.round(totalSgst * 100) / 100,
      IgstVal: Math.round(totalIgst * 100) / 100,
      CesVal: 0,
      StCesVal: 0,
      Discount: Math.round(discount * 100) / 100,
      OthChrg: 0,
      RndOffAmt: 0,
      TotInvVal: Math.round(totalInvVal * 100) / 100,
      TotInvValFc: 0,
    },
  };
}

// ─── API: Generate IRN ───────────────────────────────────────

async function generateIRN(companyId, invoiceData) {
  const config = getConfig();
  const payload = buildEInvoicePayload(invoiceData);
  const headers = await getHeaders();

  const response = await fetch(`${config.baseUrl}/api/einvoice/GenerateIRN`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.Success) {
    const errMsg = data?.ErrorDetails?.[0]?.ErrorMessage || data?.Message || JSON.stringify(data);
    throw new Error(`Taxpro IRN generation failed: ${errMsg}`);
  }

  const result = data.Data;
  return {
    irn: result.Irn,
    ackNumber: result.AckNo,
    ackDate: result.AckDt,
    signedQr: result.SignedQRCode || '',
    signedInvoice: result.SignedInvoice || '',
  };
}

// ─── API: Cancel IRN ─────────────────────────────────────────

async function cancelIRN(companyId, irn, reason, remark) {
  const config = getConfig();
  const headers = await getHeaders();

  const cancelPayload = {
    Irn: irn,
    CnlRsn: reason || '2',
    CnlRem: remark || 'Data entry mistake',
  };

  const response = await fetch(`${config.baseUrl}/api/einvoice/CancelIRN`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cancelPayload),
  });

  const data = await response.json();

  if (!response.ok || !data.Success) {
    const errMsg = data?.ErrorDetails?.[0]?.ErrorMessage || data?.Message || JSON.stringify(data);
    throw new Error(`Taxpro IRN cancellation failed: ${errMsg}`);
  }

  return {
    cancelled: true,
    cancelDate: data.Data?.CancelDate || new Date().toISOString(),
  };
}

// ─── API: Generate E-Way Bill by IRN ─────────────────────────

async function generateEwayBill(companyId, irn, transportArgs) {
  const config = getConfig();
  const headers = await getHeaders();

  if (!irn) throw new Error('IRN is required to generate E-Way Bill');

  const ewbPayload = {
    Irn: irn,
    Distance: transportArgs.distance_km || 0,
    TransMode: transportArgs.transport_mode || '1',
    TransId: transportArgs.transporter_id || '',
    TransName: transportArgs.transporter_name || '',
    TransDocNo: transportArgs.trans_doc_no || '',
    TransDocDt: transportArgs.trans_doc_dt || '',
    VehNo: transportArgs.vehicle_no || '',
    VehType: transportArgs.vehicle_type || 'R',
  };

  const response = await fetch(`${config.baseUrl}/api/ewaybill/GenerateEWayBillByIRN`, {
    method: 'POST',
    headers,
    body: JSON.stringify(ewbPayload),
  });

  const data = await response.json();

  if (!response.ok || !data.Success) {
    const errMsg = data?.ErrorDetails?.[0]?.ErrorMessage || data?.Message || JSON.stringify(data);
    throw new Error(`Taxpro E-Way Bill generation failed: ${errMsg}`);
  }

  const result = data.Data;
  return {
    ewbNo: result.EwbNo,
    ewbDt: result.EwbDt,
    validUpto: result.EwbValidTill,
  };
}

// ─── API: Cancel E-Way Bill ──────────────────────────────────

async function cancelEwayBill(companyId, ewbNo, reason, remark) {
  const config = getConfig();
  const headers = await getHeaders();

  const cancelPayload = {
    ewbNo: parseInt(ewbNo, 10) || ewbNo,
    cancelRsnCode: parseInt(reason, 10) || 2,
    cancelRmrk: remark || 'Cancelled',
  };

  const response = await fetch(`${config.baseUrl}/api/ewaybill/CancelEWayBill`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cancelPayload),
  });

  const data = await response.json();

  if (!response.ok || !data.Success) {
    const errMsg = data?.ErrorDetails?.[0]?.ErrorMessage || data?.Message || JSON.stringify(data);
    throw new Error(`Taxpro E-Way Bill cancellation failed: ${errMsg}`);
  }

  return {
    cancelled: true,
    cancelDate: data.Data?.CancelDate || new Date().toISOString(),
  };
}

module.exports = {
  generateIRN,
  cancelIRN,
  generateEwayBill,
  cancelEwayBill,
  buildEInvoicePayload,
  isTaxproEnabled,
};
