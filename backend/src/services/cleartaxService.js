/**
 * ClearTax E-Invoice & E-Way Bill Integration Service
 * API Docs: https://docs.cleartax.in
 *
 * Sandbox:    https://api-sandbox.clear.in
 * Production: https://api.clear.in
 *
 * Required ENV:
 *   CLEARTAX_ENV           = sandbox | production
 *   CLEARTAX_AUTH_TOKEN     = workspace auth token from ClearTax dashboard
 *   CLEARTAX_GSTIN          = seller GSTIN registered on ClearTax
 */

const SANDBOX_BASE = 'https://api-sandbox.clear.in';
const PROD_BASE = 'https://api.clear.in';

// ─── Config ──────────────────────────────────────────────────

function getConfig() {
  const isProduction = process.env.CLEARTAX_ENV === 'production';
  return {
    baseUrl: isProduction ? PROD_BASE : SANDBOX_BASE,
    authToken: process.env.CLEARTAX_AUTH_TOKEN || '',
    gstin: process.env.CLEARTAX_GSTIN || '',
    isProduction,
  };
}

function isCleartaxEnabled() {
  return !!(
    process.env.CLEARTAX_AUTH_TOKEN &&
    process.env.CLEARTAX_GSTIN
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function headers(config) {
  return {
    'Content-Type': 'application/json',
    'x-cleartax-auth-token': config.authToken,
    'x-cleartax-product': 'EInvoice',
    'gstin': config.gstin,
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

async function generateIRN(_companyId, invoiceData) {
  const config = getConfig();
  const payload = buildEInvoicePayload(invoiceData);

  const response = await fetch(`${config.baseUrl}/einv/v2/eInvoice/generate`, {
    method: 'PUT',
    headers: headers(config),
    body: JSON.stringify([payload]),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`ClearTax IRN generation failed: ${errMsg}`);
  }

  // ClearTax returns an array; pick first result
  const result = Array.isArray(data) ? data[0] : data;
  const govt = result?.govt_response || result;

  if (govt?.ErrorDetails && govt.ErrorDetails.length > 0) {
    throw new Error(`IRN Error: ${govt.ErrorDetails.map((e) => e.error_message || e.ErrorMessage).join('; ')}`);
  }

  return {
    irn: govt.Irn || govt.irn,
    ackNumber: govt.AckNo || govt.ack_no,
    ackDate: govt.AckDt || govt.ack_dt,
    signedQr: govt.SignedQRCode || govt.signed_qr_code || '',
    signedInvoice: govt.SignedInvoice || govt.signed_invoice || '',
  };
}

// ─── API: Cancel IRN ─────────────────────────────────────────

async function cancelIRN(_companyId, irn, reason, remark) {
  const config = getConfig();

  // ClearTax cancel reason codes: 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others
  const cancelPayload = [{
    Irn: irn,
    CnlRsn: reason || '2',
    CnlRem: remark || 'Data entry mistake',
  }];

  const response = await fetch(`${config.baseUrl}/einv/v2/eInvoice/cancel`, {
    method: 'PUT',
    headers: headers(config),
    body: JSON.stringify(cancelPayload),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`ClearTax IRN cancellation failed: ${errMsg}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  const govt = result?.govt_response || result;

  return {
    cancelled: true,
    cancelDate: govt?.CancelDate || govt?.cancel_date || new Date().toISOString(),
  };
}

// ─── API: Generate E-Way Bill by IRN ─────────────────────────

async function generateEwayBill(_companyId, irn, transportArgs) {
  const config = getConfig();

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
    VehType: transportArgs.vehicle_type || 'R', // R = Regular, O = Over Dimensional
  };

  const response = await fetch(`${config.baseUrl}/einv/v2/eInvoice/ewb`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(ewbPayload),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`ClearTax E-Way Bill generation failed: ${errMsg}`);
  }

  const govt = data?.govt_response || data;

  if (govt?.ErrorDetails && govt.ErrorDetails.length > 0) {
    throw new Error(`EWB Error: ${govt.ErrorDetails.map((e) => e.error_message || e.ErrorMessage).join('; ')}`);
  }

  return {
    ewbNo: govt.EwbNo || govt.ewb_no,
    ewbDt: govt.EwbDt || govt.ewb_dt,
    validUpto: govt.EwbValidTill || govt.ewb_valid_till,
  };
}

// ─── API: Cancel E-Way Bill ──────────────────────────────────

async function cancelEwayBill(_companyId, ewbNo, reason, remark) {
  const config = getConfig();

  const cancelPayload = {
    ewbNo: parseInt(ewbNo, 10) || ewbNo,
    cancelRsnCode: parseInt(reason, 10) || 2,
    cancelRmrk: remark || 'Cancelled',
  };

  const response = await fetch(`${config.baseUrl}/einv/v2/eInvoice/ewb/cancel`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(cancelPayload),
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`ClearTax E-Way Bill cancellation failed: ${errMsg}`);
  }

  return {
    cancelled: true,
    cancelDate: data?.cancelDate || new Date().toISOString(),
  };
}

module.exports = {
  generateIRN,
  cancelIRN,
  generateEwayBill,
  cancelEwayBill,
  buildEInvoicePayload,
  isCleartaxEnabled,
};
