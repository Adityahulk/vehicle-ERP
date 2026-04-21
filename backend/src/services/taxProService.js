/**
 * TaxPro (CharteredInfo) E-Invoice (IRN) & E-Way Bill — URL-based sandbox / production APIs.
 * Sandbox: https://gstsandbox.charteredinfo.com
 * Production e-Invoice / EWB: https://einvapi.charteredinfo.com
 */

const redis = require('../config/redis');

const SANDBOX_HOST = 'https://gstsandbox.charteredinfo.com';
const PRODUCTION_HOST = 'https://einvapi.charteredinfo.com';
const SANDBOX_EWB_AUTH_PATH = '/ewaybillapi/dec/v1.03/auth';
const SANDBOX_EWB_API_PATH = '/ewaybillapi/dec/v1.03/ewayapi';
const PRODUCTION_EWB_AUTH_PATH = '/v1.03/dec/auth';
const PRODUCTION_EWB_API_PATH = '/v1.03/dec/ewayapi';
const EINV_AUTH_PATH = '/eivital/dec/v1.04/auth';
const EINV_INVOICE_PATH = '/eicore/dec/v1.03/Invoice';
const EINV_CANCEL_PATH = '/eicore/dec/v1.03/Invoice/Cancel';

const REDIS_EINV_PREFIX = 'taxpro:einv:auth:';
const REDIS_EWB_PREFIX = 'taxpro:ewb:auth:';
const TOKEN_TTL_SEC = 5 * 60 * 60; // 360 min validity; refresh early

const memoryEinv = new Map();
const memoryEwb = new Map();

function getConfig() {
  const env = String(process.env.TAXPRO_ENV || 'sandbox').trim().toLowerCase();
  const isProduction = env === 'production';
  return {
    host: (process.env.TAXPRO_API_HOST || '').trim() || (isProduction ? PRODUCTION_HOST : SANDBOX_HOST),
    isProduction,
    env,
    aspid: (process.env.TAXPRO_ASPID || '').trim(),
    password: (process.env.TAXPRO_PASSWORD || '').trim(),
    einvUser: (process.env.TAXPRO_EINV_USER_NAME || process.env.TAXPRO_USER_NAME || '').trim(),
    einvPwd: (process.env.TAXPRO_EINV_PASSWORD || '').trim(),
    ewbUser: (process.env.TAXPRO_EWB_USER_NAME || process.env.TAXPRO_USER_NAME || '').trim(),
    ewbPwd: (process.env.TAXPRO_EWB_PASSWORD || '').trim(),
    qrCodeSize: (process.env.TAXPRO_QR_CODE_SIZE || '250').trim(),
    ewbGenAction: (process.env.TAXPRO_EWB_GEN_ACTION || 'GENEWAYBILL').trim(),
    ewbCancelAction: (process.env.TAXPRO_EWB_CANCEL_ACTION || 'CANEWB').trim(),
    einvAuthPath: (process.env.TAXPRO_EINV_AUTH_PATH || EINV_AUTH_PATH).trim(),
    einvInvoicePath: (process.env.TAXPRO_EINV_INVOICE_PATH || EINV_INVOICE_PATH).trim(),
    einvCancelPath: (process.env.TAXPRO_EINV_CANCEL_PATH || EINV_CANCEL_PATH).trim(),
    ewbAuthPath: (
      process.env.TAXPRO_EWB_AUTH_PATH
      || (isProduction ? PRODUCTION_EWB_AUTH_PATH : SANDBOX_EWB_AUTH_PATH)
    ).trim(),
    ewbApiPath: (
      process.env.TAXPRO_EWB_API_PATH
      || (isProduction ? PRODUCTION_EWB_API_PATH : SANDBOX_EWB_API_PATH)
    ).trim(),
  };
}

function normalizeGstin(v) {
  return String(v || '').trim().toUpperCase();
}

function joinHostAndPath(host, endpointPath) {
  const h = String(host || '').trim().replace(/\/+$/, '');
  const p = `/${String(endpointPath || '').trim().replace(/^\/+/, '')}`;
  return `${h}${p}`;
}

function isTaxProEnabled() {
  const c = getConfig();
  return !!(
    c.aspid
    && c.password
    && c.einvUser
    && c.einvPwd
    && c.ewbUser
    && c.ewbPwd
  );
}

function isTaxProEinvoiceEnabled() {
  const c = getConfig();
  return !!(c.aspid && c.password && c.einvUser && c.einvPwd);
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
  if (Number.isNaN(d.getTime())) return formatDateDdMmYyyy(new Date());
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function normalizeTransDocDate(dt) {
  if (!dt) return formatDateDdMmYyyy(new Date());
  if (typeof dt === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dt)) return dt;
  return formatDateDdMmYyyy(dt);
}

function digitsOnlyPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '').substring(0, 12);
  return d.length >= 10 ? d : '9999999999';
}

function safeLocFromAddress(address, fallback) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const loc = last.replace(/\b\d{6}\b/, '').trim();
  return (loc.length >= 3 ? loc : fallback).substring(0, 100);
}

function sanitizeDocNumber(raw, fallback = 'INV1') {
  let s = String(raw || '').trim();
  // Allow only TaxPro/NIC-safe chars and max length 16.
  s = s.replace(/[^a-zA-Z0-9/-]/g, '');
  if (s.length > 16) s = s.slice(0, 16);
  // First character cannot be 0 and must be alnum (1-9/A-Z/a-z).
  while (s && !/^[a-zA-Z1-9]/.test(s)) s = s.slice(1);
  if (!s) s = fallback;
  if (!/^[a-zA-Z1-9]/.test(s)) s = `A${s}`.slice(0, 16);
  return s.slice(0, 16);
}

function normalizeEmail(email, fallback = 'na@example.com') {
  const e = String(email || '').trim();
  if (e.length >= 6 && e.length <= 100) return e;
  return fallback;
}

function splitAddressLines(address) {
  const cleaned = String(address || '').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  let addr1 = (parts[0] || cleaned || 'NA.').slice(0, 100);
  if (addr1.length < 3) addr1 = 'NA.';
  let addr2 = parts.length > 1 ? parts.slice(1).join(', ') : '';
  addr2 = (addr2 || addr1 || 'NA.').slice(0, 100);
  if (addr2.length < 3) addr2 = 'NA.';
  return { addr1, addr2 };
}

function logTaxProFailure(context, response, data) {
  const status = response?.status;
  let snippet = '';
  try {
    snippet = JSON.stringify(data).slice(0, 4000);
  } catch {
    snippet = String(data);
  }
  console.error(`[taxPro] ${context} HTTP ${status}: ${snippet}`);
}

function unwrapData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.Data != null) {
    if (typeof obj.Data === 'object') return obj.Data;
    if (typeof obj.Data === 'string') {
      try {
        const parsed = JSON.parse(obj.Data);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        /* keep outer object when Data is non-JSON string */
      }
    }
  }
  if (obj.data != null) {
    if (typeof obj.data === 'object') return obj.data;
    if (typeof obj.data === 'string') {
      try {
        const parsed = JSON.parse(obj.data);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        /* keep outer object when data is non-JSON string */
      }
    }
  }
  return obj;
}

function parseTaxProError(data) {
  if (data == null) return 'empty response';
  if (typeof data === 'string') return data.slice(0, 2000);
  if (typeof data._rawBody === 'string' && data._rawBody) {
    return `non-JSON response: ${data._rawBody.slice(0, 1500)}`;
  }
  const u = unwrapData(data);
  const err = u?.ErrorDetails || u?.errorDetails || data.ErrorDetails;
  if (Array.isArray(err) && err.length) {
    return err.map((e) => e?.ErrorMessage || e?.errorMessage || JSON.stringify(e)).join('; ');
  }
  if (typeof u?.message === 'string' && u.message) return u.message;
  if (typeof data?.message === 'string') return data.message;
  if (typeof u?.Status === 'string' && u.Status !== '1' && u?.ErrorMessage) return String(u.ErrorMessage);
  try {
    const s = JSON.stringify(data);
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  } catch {
    return 'Unknown TaxPro API error';
  }
}

function extractAuthToken(body) {
  const u = unwrapData(body);
  const t = u?.AuthToken
    || u?.authToken
    || u?.authtoken
    || body?.AuthToken
    || body?.authtoken
    || body?.auth_token
    || body?.access_token;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function parseIndianDateTimeLoose(str) {
  if (str == null) return null;
  if (str instanceof Date && !Number.isNaN(str.getTime())) return str.toISOString();
  const s = String(str).trim();
  if (!s) return null;
  const isoTry = Date.parse(s);
  if (!Number.isNaN(isoTry)) return new Date(isoTry).toISOString();
  const norm = s.replace(/(\d{2})\.(\d{2})\.(\d{4})/, '$1/$2/$3');
  const m = norm.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const idx = norm.indexOf(m[0]) + m[0].length;
  const rest = norm.slice(idx).trim();
  let h = 12;
  let min = 0;
  let sec = 0;
  const tm = rest.match(/(\d{1,2})[:.](\d{2})[:.](\d{2})\s*(AM|PM)?/i);
  if (tm) {
    h = parseInt(tm[1], 10);
    min = parseInt(tm[2], 10);
    sec = parseInt(tm[3], 10);
    const ap = tm[4];
    if (ap && ap.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ap && ap.toUpperCase() === 'AM' && h === 12) h = 0;
  }
  const local = new Date(
    parseInt(yyyy, 10),
    parseInt(mm, 10) - 1,
    parseInt(dd, 10),
    h,
    min,
    sec,
  );
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

async function cacheTokenGet(mapMem, redisKey) {
  const now = Date.now();
  const mem = mapMem.get(redisKey);
  if (mem && mem.expiry > now + 120000 && mem.token) return mem.token;
  try {
    const cached = await redis.get(redisKey);
    const exp = await redis.get(`${redisKey}:exp`);
    if (cached && Number(exp) > now + 120000) {
      mapMem.set(redisKey, { token: cached, expiry: Number(exp) });
      return cached;
    }
  } catch (e) {
    console.warn('Redis cache read failed (taxProService):', e.message);
  }
  return null;
}

async function cacheTokenSet(mapMem, redisKey, token) {
  const expiry = Date.now() + TOKEN_TTL_SEC * 1000;
  mapMem.set(redisKey, { token, expiry });
  try {
    await redis.set(redisKey, token, 'EX', TOKEN_TTL_SEC);
    await redis.set(`${redisKey}:exp`, String(expiry), 'EX', TOKEN_TTL_SEC);
  } catch (e) {
    console.warn('Redis cache write failed (taxProService):', e.message);
  }
}

async function cacheTokenDelete(mapMem, redisKey) {
  mapMem.delete(redisKey);
  try {
    await redis.del(redisKey);
    await redis.del(`${redisKey}:exp`);
  } catch (e) {
    console.warn('Redis cache delete failed (taxProService):', e.message);
  }
}

function isAuthTokenExpiredError(data) {
  const raw = parseTaxProError(data).toLowerCase();
  if (!raw) return false;
  if (raw.includes('gsp752')) return true;
  const hasAuthToken = raw.includes('authtoken') || raw.includes('auth token');
  const hasExpirySignal = raw.includes('expired') || raw.includes('not found') || raw.includes('invalid');
  return hasAuthToken && hasExpirySignal;
}

async function getEInvoiceAuthToken(sellerGstin) {
  const c = getConfig();
  if (!c.aspid || !c.password || !c.einvUser || !c.einvPwd) {
    throw new Error('TaxPro e-invoice auth requires TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EINV_USER_NAME, TAXPRO_EINV_PASSWORD');
  }
  const gstin = normalizeGstin(sellerGstin);
  if (!gstin) throw new Error('Seller GSTIN required for TaxPro e-invoice auth');

  const redisKey = `${REDIS_EINV_PREFIX}${gstin}`;
  const hit = await cacheTokenGet(memoryEinv, redisKey);
  if (hit) return hit;

  const q = new URLSearchParams({
    aspid: c.aspid,
    password: c.password,
    Gstin: gstin,
    User_name: c.einvUser,
    eInvPwd: c.einvPwd,
  });
  const url = `${joinHostAndPath(c.host, c.einvAuthPath)}?${q.toString()}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { _rawBody: text };
    }
  }
  if (!response.ok) {
    logTaxProFailure('einv auth', response, data);
    throw new Error(`TaxPro e-invoice auth failed: ${parseTaxProError(data)} (HTTP ${response.status})`);
  }
  const token = extractAuthToken(data);
  if (!token) {
    logTaxProFailure('einv auth (no token)', response, data);
    throw new Error(`TaxPro e-invoice auth did not return AuthToken: ${parseTaxProError(data)}`);
  }
  await cacheTokenSet(memoryEinv, redisKey, token);
  return token;
}

async function getEwbAuthToken(gstinArg) {
  const c = getConfig();
  if (!c.aspid || !c.password || !c.ewbUser || !c.ewbPwd) {
    throw new Error('TaxPro e-way auth requires TAXPRO_ASPID, TAXPRO_PASSWORD, TAXPRO_EWB_USER_NAME, TAXPRO_EWB_PASSWORD');
  }
  const gstin = normalizeGstin(gstinArg);
  if (!gstin) throw new Error('GSTIN required for TaxPro e-way auth');

  const redisKey = `${REDIS_EWB_PREFIX}${gstin}`;
  const hit = await cacheTokenGet(memoryEwb, redisKey);
  if (hit) return hit;

  const q = new URLSearchParams({
    action: 'ACCESSTOKEN',
    aspid: c.aspid,
    password: c.password,
    gstin,
    username: c.ewbUser,
    ewbpwd: c.ewbPwd,
  });
  const url = `${joinHostAndPath(c.host, c.ewbAuthPath)}?${q.toString()}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { _rawBody: text };
    }
  }
  if (!response.ok) {
    logTaxProFailure('ewb auth', response, data);
    throw new Error(`TaxPro e-way auth failed: ${parseTaxProError(data)} (HTTP ${response.status})`);
  }
  const token = extractAuthToken(data);
  if (!token) {
    logTaxProFailure('ewb auth (no token)', response, data);
    throw new Error(`TaxPro e-way auth did not return AuthToken: ${parseTaxProError(data)}`);
  }
  await cacheTokenSet(memoryEwb, redisKey, token);
  return token;
}

/**
 * NIC e-Invoice JSON 1.1 for TaxPro POST /eicore/dec/v1.03/Invoice
 */
function buildNicEInvoicePayload(invoiceData) {
  const { invoice: inv, items } = invoiceData;
  const userGstin = normalizeGstin(inv.company_gstin);
  if (!userGstin) throw new Error('Company GSTIN is required for e-invoice');

  const sellerStateCode = userGstin.substring(0, 2);
  const rawBuyerGstin = inv.customer_gstin && String(inv.customer_gstin).trim()
    ? String(inv.customer_gstin).trim()
    : 'URP';
  const buyerStateCode = rawBuyerGstin !== 'URP' && rawBuyerGstin.length >= 2
    ? rawBuyerGstin.substring(0, 2)
    : sellerStateCode;

  let docTyp = 'INV';
  if (inv.invoice_number?.startsWith('CN-')) docTyp = 'CRN';
  if (inv.invoice_number?.startsWith('DN-')) docTyp = 'DBN';

  const itemList = (items || []).map((item, idx) => {
    const unitPrice = Math.round(toRupees(item.unit_price) * 100) / 100;
    const qty = Number(item.quantity) || 1;
    const totAmt = Math.round(unitPrice * qty * 100) / 100;
    const discount = 0;
    const assAmt = Math.round((totAmt - discount) * 100) / 100;
    const cgstAmt = Math.round(toRupees(item.cgst_amount) * 100) / 100;
    const sgstAmt = Math.round(toRupees(item.sgst_amount) * 100) / 100;
    const igstAmt = Math.round(toRupees(item.igst_amount) * 100) / 100;
    const gstRt = Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0) + Number(item.igst_rate || 0);
    const totItemVal = Math.round((assAmt + cgstAmt + sgstAmt + igstAmt) * 100) / 100;

    return {
      SlNo: String(idx + 1),
      PrdDesc: (item.description || 'Item').substring(0, 300),
      IsServc: 'N',
      HsnCd: (String(item.hsn_code || '').replace(/\D/g, '').substring(0, 8) || '8703'),
      Qty: qty,
      Unit: 'NOS',
      UnitPrice: unitPrice,
      TotAmt: totAmt,
      Discount: 0,
      AssAmt: assAmt,
      GstRt: gstRt,
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
      TotItemVal: totItemVal,
    };
  });

  const totalAssVal = itemList.reduce((s, i) => s + i.AssAmt, 0);
  const totalCgst = itemList.reduce((s, i) => s + i.CgstAmt, 0);
  const totalSgst = itemList.reduce((s, i) => s + i.SgstAmt, 0);
  const totalIgst = itemList.reduce((s, i) => s + i.IgstAmt, 0);
  const discountInv = Math.round(toRupees(inv.discount || 0) * 100) / 100;
  const totInvVal = Math.round((totalAssVal + totalCgst + totalSgst + totalIgst - discountInv) * 100) / 100;

  const sellerPin = extractPin(inv.company_address);
  if (!sellerPin) throw new Error("A valid 6-digit Pincode must be present in the user's Company Address.");
  const buyerPin = extractPin(inv.customer_address);
  if (!buyerPin) throw new Error("A valid 6-digit Pincode must be present in the Customer Address.");

  const sellerAddr = String(inv.company_address || 'Address');
  const buyerAddr = String(inv.customer_address || 'Address');
  const sellerAddrLines = splitAddressLines(sellerAddr);
  const buyerAddrLines = splitAddressLines(buyerAddr);
  const ecmGstin = normalizeGstin(inv.ecom_gstin || inv.ecommerce_gstin || '');
  const tranDtls = {
    TaxSch: 'GST',
    SupTyp: 'B2B',
    RegRev: 'N',
    IgstOnIntra: 'N',
  };
  if (ecmGstin.length === 15) tranDtls.EcmGstin = ecmGstin;

  return {
    Version: '1.1',
    TranDtls: tranDtls,
    DocDtls: {
      Typ: docTyp,
      No: sanitizeDocNumber(inv.invoice_number),
      Dt: formatDateDdMmYyyy(inv.invoice_date),
    },
    SellerDtls: {
      Gstin: userGstin,
      LglNm: (inv.company_name || 'Seller').substring(0, 100),
      TrdNm: (inv.company_name || 'Seller').substring(0, 100),
      Addr1: sellerAddrLines.addr1,
      Addr2: sellerAddrLines.addr2,
      Loc: safeLocFromAddress(inv.company_address, 'City'),
      Pin: sellerPin,
      Stcd: sellerStateCode,
      Ph: digitsOnlyPhone(inv.company_phone),
      Em: normalizeEmail(inv.company_email),
    },
    BuyerDtls: {
      Gstin: rawBuyerGstin,
      LglNm: (inv.customer_name || 'Buyer').substring(0, 100),
      TrdNm: (inv.customer_name || 'Buyer').substring(0, 100),
      Pos: buyerStateCode,
      Addr1: buyerAddrLines.addr1,
      Addr2: buyerAddrLines.addr2,
      Loc: safeLocFromAddress(inv.customer_address, 'City'),
      Pin: buyerPin,
      Stcd: buyerStateCode,
      Ph: digitsOnlyPhone(inv.customer_phone),
      Em: normalizeEmail(inv.customer_email),
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: Math.round(totalAssVal * 100) / 100,
      CgstVal: Math.round(totalCgst * 100) / 100,
      SgstVal: Math.round(totalSgst * 100) / 100,
      IgstVal: Math.round(totalIgst * 100) / 100,
      CesVal: 0,
      StCesVal: 0,
      Discount: discountInv,
      OthChrg: 0,
      RndOffAmt: 0,
      TotInvVal: totInvVal,
    },
  };
}

function pickIrnSuccessFields(u) {
  const irn = u?.Irn || u?.irn;
  const ackNumber = u?.AckNo != null ? String(u.AckNo) : (u?.ackNo != null ? String(u.ackNo) : '');
  const ackDate = u?.AckDt || u?.ackDt || '';
  const signedQr = u?.SignedQRCode || u?.signedQRCode || '';
  const signedInvoice = u?.SignedInvoice || u?.signedInvoice || '';
  return { irn, ackNumber, ackDate, signedQr, signedInvoice };
}

async function generateIRN(_companyId, invoiceData) {
  const inv = invoiceData.invoice;
  const sellerGstin = normalizeGstin(inv.company_gstin);
  if (!sellerGstin) {
    throw new Error('Company GSTIN is required for e-invoice (set on company profile)');
  }

  const c = getConfig();
  const body = buildNicEInvoicePayload(invoiceData);
  const redisKey = `${REDIS_EINV_PREFIX}${sellerGstin}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authToken = await getEInvoiceAuthToken(sellerGstin);
    const q = new URLSearchParams({
      aspid: c.aspid,
      password: c.password,
      Gstin: sellerGstin,
      AuthToken: authToken,
      QrCodeSize: c.qrCodeSize,
      User_name: c.einvUser,
    });
    const url = `${joinHostAndPath(c.host, c.einvInvoicePath)}?${q.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { _rawBody: text };
      }
    }

    const u = unwrapData(data);
    const { irn, ackNumber, ackDate, signedQr, signedInvoice } = pickIrnSuccessFields(u);

    if (!response.ok || !irn) {
      if (attempt === 0 && isAuthTokenExpiredError(data)) {
        await cacheTokenDelete(memoryEinv, redisKey);
        continue;
      }
      logTaxProFailure('generateIRN', response, data);
      throw new Error(`TaxPro IRN generation failed: ${parseTaxProError(data)} (HTTP ${response.status})`);
    }

    const ackIso = parseIndianDateTimeLoose(ackDate) || (ackDate ? String(ackDate) : null);
    return {
      irn,
      ackNumber,
      ackDate: ackIso || new Date().toISOString(),
      signedQr,
      signedInvoice,
    };
  }
  throw new Error('TaxPro IRN generation failed: unable to refresh auth token');
}

function mapCancelReasonToCnlRsn(reason) {
  if (reason == null || String(reason).trim() === '') return '2';
  const s = String(reason).trim();
  if (/^[1-4]$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower.includes('duplicate')) return '1';
  if (lower.includes('order') || lower.includes('cancel')) return '2';
  if (lower.includes('data') || lower.includes('mistake')) return '3';
  return '4';
}

async function cancelIRN(_companyId, irn, reason, remark, userGstin) {
  const gstin = normalizeGstin(userGstin);
  if (!gstin) throw new Error('Company GSTIN is required to cancel IRN');
  if (!irn) throw new Error('IRN required');

  const c = getConfig();
  const redisKey = `${REDIS_EINV_PREFIX}${gstin}`;
  const payload = {
    Irn: irn,
    CnlRsn: mapCancelReasonToCnlRsn(reason),
    CnlRem: (remark && String(remark).trim()) || 'Data entry mistake',
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authToken = await getEInvoiceAuthToken(gstin);
    const q = new URLSearchParams({
      aspid: c.aspid,
      password: c.password,
      Gstin: gstin,
      AuthToken: authToken,
      User_name: c.einvUser,
    });
    const url = `${joinHostAndPath(c.host, c.einvCancelPath)}?${q.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { _rawBody: text };
      }
    }

    const u = unwrapData(data);
    const cancelDt = u?.CancelDate || u?.cancelDate || u?.CnlDt || '';

    if (!response.ok) {
      if (attempt === 0 && isAuthTokenExpiredError(data)) {
        await cacheTokenDelete(memoryEinv, redisKey);
        continue;
      }
      logTaxProFailure('cancelIRN', response, data);
      throw new Error(`TaxPro IRN cancellation failed: ${parseTaxProError(data)} (HTTP ${response.status})`);
    }

    return {
      cancelled: true,
      cancelDate: parseIndianDateTimeLoose(cancelDt) || new Date().toISOString(),
    };
  }
  throw new Error('TaxPro IRN cancellation failed: unable to refresh auth token');
}

function buildPartyDtlsForEwb(name, address, gstin) {
  const pin = extractPin(address) || 201301;
  const stcd = gstin && gstin.length >= 2 ? gstin.substring(0, 2) : '09';
  return {
    Nm: (name || 'Party').substring(0, 100),
    Addr1: String(address || 'Address').substring(0, 100),
    Addr2: '',
    Loc: safeLocFromAddress(address, 'City'),
    Pin: pin,
    Stcd: stcd,
  };
}

function buildEwbByIrnBody(irn, transportArgs, parties) {
  const transId = String(transportArgs.transporter_id || '').trim().toUpperCase();
  if (transId.length !== 15) {
    throw new Error('transporter_id must be a 15-character transporter GSTIN');
  }
  let transName = String(transportArgs.transporter_name || 'Transport').trim();
  if (transName.length < 3) transName = transName.padEnd(3, '-');

  const vehNo = String(transportArgs.vehicle_no || '').replace(/\s/g, '').toUpperCase();
  if (vehNo.length < 4) throw new Error('vehicle_no must be at least 4 characters');

  const body = {
    Irn: irn,
    TransId: transId,
    TransName: transName.substring(0, 100),
    TransMode: String(transportArgs.transport_mode || '1'),
    Distance: Number(transportArgs.distance_km) || 0,
    TransDocNo: String(transportArgs.trans_doc_no || '1').substring(0, 15),
    // Prefer explicit transport date; fallback to IRN ack date, then invoice date.
    TransDocDt: normalizeTransDocDate(
      transportArgs.trans_doc_dt || transportArgs.ack_date || transportArgs.invoice_date,
    ),
    VehNo: vehNo.substring(0, 20),
    VehType: (transportArgs.vehicle_type || 'R').substring(0, 1).toUpperCase() === 'O' ? 'O' : 'R',
  };

  if (parties?.dispatch) {
    body.DispDtls = parties.dispatch;
  }
  if (parties?.shipTo) {
    body.ExpShipDtls = parties.shipTo;
  }
  return body;
}

function pickEwbGenFields(u) {
  const no = u?.ewbNo ?? u?.EwbNo ?? u?.ewayBillNo;
  const dtRaw = u?.EwbDt ?? u?.ewbDt ?? u?.ewayBillDate;
  const tillRaw = u?.EwbValidTill ?? u?.ewbValidTill ?? u?.validUpto;
  const ewbDt = parseIndianDateTimeLoose(dtRaw) || new Date().toISOString();
  const validUpto = parseIndianDateTimeLoose(tillRaw);
  return {
    ewbNo: no != null ? String(no) : '',
    ewbDt,
    validUpto: validUpto || ewbDt,
  };
}

function buildNicEwayBillPayload(invoice, items, transportArgs) {
  const sellerStateCode = (invoice.company_gstin && invoice.company_gstin.length >= 2) ? parseInt(invoice.company_gstin.substring(0, 2), 10) : 0;
  const rawBuyerGstin = (invoice.customer_gstin && invoice.customer_gstin.trim()) ? invoice.customer_gstin.trim() : 'URP';
  const buyerStateCode = (rawBuyerGstin !== 'URP' && rawBuyerGstin.length >= 2) ? parseInt(rawBuyerGstin.substring(0, 2), 10) : sellerStateCode;

  const extractPinLoc = (address) => {
      const match = String(address || '').match(/\b(\d{6})\b/);
      return match ? parseInt(match[1], 10) : 0;
  };

  const itemList = items.map((item, idx) => {
    const unitPrice = toRupees(item.unit_price);
    const qty = Number(item.quantity) || 1;
    const taxableAmount = Math.round(unitPrice * qty * 100) / 100;
    return {
      productName: (item.description || "Item").substring(0, 100),
      productDesc: (item.description || "Item").substring(0, 100),
      hsnCode: parseInt(String(item.hsn_code || '').replace(/\D/g, '').substring(0, 8) || '8703', 10),
      quantity: qty,
      qtyUnit: "NOS",
      cgstRate: Number(item.cgst_rate || 0),
      sgstRate: Number(item.sgst_rate || 0),
      igstRate: Number(item.igst_rate || 0),
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount: taxableAmount
    };
  });

  const totalValue = itemList.reduce((sum, item) => sum + item.taxableAmount, 0);
  const cgstValue = Math.round(items.reduce((sum, i) => sum + toRupees(i.cgst_amount || 0), 0) * 100) / 100;
  const sgstValue = Math.round(items.reduce((sum, i) => sum + toRupees(i.sgst_amount || 0), 0) * 100) / 100;
  const igstValue = Math.round(items.reduce((sum, i) => sum + toRupees(i.igst_amount || 0), 0) * 100) / 100;
  const discountInv = Math.round(toRupees(invoice.discount || 0) * 100) / 100;
  
  const fromPincode = extractPinLoc(invoice.company_address);
  if (!fromPincode) throw new Error("A valid 6-digit Pincode must be present in the user's Company Address.");
  
  const toPincode = extractPinLoc(invoice.customer_address);
  if (!toPincode) throw new Error("A valid 6-digit Pincode must be present in the Customer Address.");

  const safeLocName = (addr) => {
      const parts = String(addr || '').split(',').map((p) => p.trim()).filter(Boolean);
      const last = parts[parts.length - 1] || '';
      const loc = last.replace(/\b\d{6}\b/, '').trim();
      return (loc.length >= 3 ? loc : "City").substring(0, 50);
  };

  const payload = {
    supplyType: "O",
    subSupplyType: "1",
    docType: "INV",
    docNo: String(invoice.invoice_number || "INV").substring(0, 15),
    docDate: normalizeTransDocDate(transportArgs.invoice_date || invoice.invoice_date).replace(/\-/g, '/'),
    fromGstin: invoice.company_gstin,
    fromTrdName: (invoice.company_name || "Seller").substring(0, 100),
    fromAddr1: String(invoice.company_address || "Address").substring(0, 100),
    fromPlace: safeLocName(invoice.company_address),
    fromPincode: fromPincode,
    actFromStateCode: sellerStateCode,
    fromStateCode: sellerStateCode,
    toGstin: rawBuyerGstin,
    toTrdName: (invoice.customer_name || "Buyer").substring(0, 100),
    toAddr1: String(invoice.customer_address || "Address").substring(0, 100),
    toPlace: safeLocName(invoice.customer_address),
    toPincode: toPincode,
    actToStateCode: buyerStateCode,
    toStateCode: buyerStateCode,
    transactionType: 1, // 1 is Regular
    totalValue: totalValue,
    cgstValue: cgstValue,
    sgstValue: sgstValue,
    igstValue: igstValue,
    cessValue: 0,
    cessNonAdvolValue: 0,
    totInvValue: Math.round((totalValue + cgstValue + sgstValue + igstValue - discountInv) * 100) / 100,
    transMode: String(transportArgs.transport_mode || '1'),
    transDistance: "0",
    vehicleNo: String(transportArgs.vehicle_no || '').replace(/\s/g, '').toUpperCase().substring(0, 20),
    vehicleType: (transportArgs.vehicle_type || 'R').substring(0, 1).toUpperCase() === 'O' ? 'O' : 'R',
    itemList: itemList
  };

  const tId = String(transportArgs.transporter_id || '').trim().toUpperCase();
  if (tId && tId !== 'NULL' && tId !== 'NONE' && tId !== '0') {
    if (tId.length !== 15) {
      throw new Error(`Invalid Transporter ID: "${tId}". The transporter_id parameter must be exactly 15 characters (a valid Transporter GSTIN or TRANSIN). Leave it blank if not shipping via third-party transporter.`);
    }
    payload.transporterId = tId;
  }
  const tName = String(transportArgs.transporter_name || '').trim();
  if (tName) {
    payload.transporterName = tName.substring(0, 100);
  }

  return payload;
}

async function generateEwayBill(_companyId, irn, transportArgs, userGstin, parties = {}, fullInvoiceData = null) {
  if (!irn) throw new Error('IRN is required to generate E-Way Bill');
  const gstin = normalizeGstin(userGstin);
  if (!gstin) throw new Error('Company GSTIN is required for e-way bill');

  const c = getConfig();
  const redisKey = `${REDIS_EWB_PREFIX}${gstin}`;

  const dispatch = parties.companyName
    ? buildPartyDtlsForEwb(parties.companyName, parties.companyAddress, gstin)
    : null;
  const shipTo = parties.customerName
    ? buildPartyDtlsForEwb(
      parties.customerName,
      parties.customerAddress,
      parties.customerGstin || 'URP',
    )
    : null;

  let body;
  if (fullInvoiceData && fullInvoiceData.items && fullInvoiceData.items.length > 0) {
    body = buildNicEwayBillPayload(fullInvoiceData, fullInvoiceData.items, transportArgs);
    // Explicitly do not send Irn in the body here, the full EWayBill API (GENEWAYBILL) expects docDate etc.
  } else {
    body = buildEwbByIrnBody(irn, transportArgs, {
      dispatch,
      shipTo: shipTo && parties.customerAddress ? shipTo : null,
    });
  }

  console.info(
    `[taxPro] ewb request dates: input_trans_doc_dt="${String(transportArgs.trans_doc_dt || '')}" normalized_trans_doc_dt="${String(body.TransDocDt || body.docDate || '')}" irn="${String(irn || '')}"`,
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authtoken = await getEwbAuthToken(gstin);
    const q = new URLSearchParams({
      action: c.ewbGenAction,
      aspid: c.aspid,
      password: c.password,
      gstin,
      authtoken,
    });
    const url = `${joinHostAndPath(c.host, c.ewbApiPath)}?${q.toString()}`;
    console.info(
      `[taxPro] ewb request meta: host="${c.host}" path="${c.ewbApiPath}" action="${c.ewbGenAction}" gstin="${gstin}" body=${JSON.stringify({
        docNo: body.docNo || body.TransDocNo,
        docDate: body.docDate || body.TransDocDt,
        transMode: body.TransMode || body.transMode,
        distance: body.Distance || body.transDistance,
      })}`,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { _rawBody: text };
      }
    }

    const u = unwrapData(data);
    let { ewbNo, ewbDt, validUpto } = pickEwbGenFields(u);

    // Fallback: check raw response directly (GENEWAYBILL returns fields at top level, not wrapped in Data)
    if (!ewbNo && data?.ewayBillNo) {
      const fallback = pickEwbGenFields(data);
      ewbNo = fallback.ewbNo;
      ewbDt = fallback.ewbDt;
      validUpto = fallback.validUpto;
    }

    if (ewbNo) {
      // Success — even if response.ok is oddly false or there's an alert field
      console.info(`[taxPro] ewb generated successfully: ewbNo=${ewbNo} ewbDt=${ewbDt} validUpto=${validUpto} alert="${data?.alert || u?.alert || ''}" `);
      return { ewbNo, ewbDt, validUpto };
    }

    if (!response.ok) {
      if (attempt === 0 && isAuthTokenExpiredError(data)) {
        await cacheTokenDelete(memoryEwb, redisKey);
        continue;
      }
      logTaxProFailure('generateEwayBill', response, data);
      throw new Error(`TaxPro E-Way Bill generation failed: ${parseTaxProError(data)} (HTTP ${response.status})`);
    }

    // HTTP 200 but no ewbNo — unexpected
    logTaxProFailure('generateEwayBill', response, data);
    throw new Error(`TaxPro E-Way Bill generation failed: unexpected response — ${parseTaxProError(data)} (HTTP ${response.status})`);
  }
  throw new Error('TaxPro E-Way Bill generation failed: unable to refresh auth token');
}

function mapEwayCancelReasonCode(reason) {
  if (reason == null || reason === '') return 2;
  const s = String(reason);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 4) return n;
    return 4;
  }
  const lower = s.toLowerCase();
  if (lower.includes('duplicate')) return 1;
  if (lower.includes('order')) return 2;
  if (lower.includes('data') || lower.includes('mistake')) return 3;
  return 4;
}

async function cancelEwayBill(_companyId, ewbNo, reason, remark, userGstin) {
  const gstin = normalizeGstin(userGstin);
  if (!gstin) throw new Error('Company GSTIN is required to cancel e-way bill');

  const c = getConfig();
  const redisKey = `${REDIS_EWB_PREFIX}${gstin}`;

  const num = typeof ewbNo === 'string' && /^\d+$/.test(ewbNo.trim())
    ? parseInt(ewbNo.trim(), 10)
    : Number(ewbNo);

  const payload = {
    ewbNo: num,
    cancelRsnCode: mapEwayCancelReasonCode(reason),
    cancelRmrk: (remark && String(remark).trim()) || 'Cancelled',
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authtoken = await getEwbAuthToken(gstin);
    const q = new URLSearchParams({
      action: c.ewbCancelAction,
      aspid: c.aspid,
      password: c.password,
      gstin,
      authtoken,
    });
    const url = `${joinHostAndPath(c.host, c.ewbApiPath)}?${q.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { _rawBody: text };
      }
    }

    const u = unwrapData(data);
    const cancelDateRaw = u?.cancelDate || u?.CancelDate;

    if (!response.ok) {
      if (attempt === 0 && isAuthTokenExpiredError(data)) {
        await cacheTokenDelete(memoryEwb, redisKey);
        continue;
      }
      logTaxProFailure('cancelEwayBill', response, data);
      throw new Error(`TaxPro E-Way Bill cancellation failed: ${parseTaxProError(data)} (HTTP ${response.status})`);
    }

    return {
      cancelled: true,
      cancelDate: parseIndianDateTimeLoose(cancelDateRaw) || new Date().toISOString(),
    };
  }
  throw new Error('TaxPro E-Way Bill cancellation failed: unable to refresh auth token');
}

module.exports = {
  isTaxProEnabled,
  isTaxProEinvoiceEnabled,
  generateIRN,
  cancelIRN,
  generateEwayBill,
  cancelEwayBill,
  buildNicEInvoicePayload,
};
