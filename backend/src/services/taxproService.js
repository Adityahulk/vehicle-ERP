/**
 * TaxPro GSP API Integration Service
 * Handles E-Invoicing (IRN) and E-Way Bill generation
 */

const { query } = require('../config/db');

const SANDBOX_BASE_URL = 'https://api.sandbox.taxprogsp.co.in';
const PROD_BASE_URL = 'https://api.taxprogsp.co.in';

function getConfig() {
  const isProduction = process.env.TAXPRO_ENV === 'production';
  return {
    baseUrl: isProduction ? PROD_BASE_URL : SANDBOX_BASE_URL,
    clientId: process.env.TAXPRO_CLIENT_ID || '',
    clientSecret: process.env.TAXPRO_CLIENT_SECRET || '',
    gstin: process.env.TAXPRO_USERNAME_GSTIN || '',
    isProduction,
  };
}

/**
 * Authenticate with TaxPro GSP to get ASP Auth Token.
 * Note: TaxPro APIs might use OAuth2 or a specific /authenticate endpoint 
 * returning an AuthToken valid for several hours.
 */
async function authenticate(companyId) {
  const config = getConfig();

  const { rows: cached } = await query(
    `SELECT auth_token, token_expiry FROM einvoice_tokens
     WHERE company_id = $1 AND gstin = $2 AND token_expiry > NOW()`,
    [companyId, config.gstin],
  );
  if (cached.length > 0) {
    return { authToken: cached[0].auth_token };
  }

  // To be replaced with exact TaxPro Auth Endpoint
  // Example standard OAuth structure:
  /*
  const response = await fetch(`${config.baseUrl}/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      client_id: config.clientId, 
      client_secret: config.clientSecret 
    }),
  });
  const data = await response.json();
  const token = data.access_token;
  */

  // Mock token logic for now until API credentials are provided
  const token = `mock_taxpro_token_${Date.now()}`;
  const expiry = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

  await query(
    `INSERT INTO einvoice_tokens (company_id, gstin, auth_token, sek, token_expiry)
     VALUES ($1, $2, $3, 'taxpro_no_sek_needed', $4)
     ON CONFLICT (company_id, gstin)
     DO UPDATE SET auth_token = $3, token_expiry = $4`,
    [companyId, config.gstin, token, expiry],
  );

  return { authToken: token };
}

/**
 * Build standard NIC/TaxPro JSON payload from our invoice data.
 */
function buildEInvoicePayload(invoiceData) {
  const { invoice: inv, items } = invoiceData;
  const toRupees = (paise) => Math.round(Number(paise)) / 100;

  const hasIgst = items.some((i) => Number(i.igst_amount) > 0);
  const supTyp = hasIgst ? 'INTRSUP' : 'B2B';

  let docTyp = 'INV';
  if (inv.invoice_number?.startsWith('CN-')) docTyp = 'CRN';
  if (inv.invoice_number?.startsWith('DN-')) docTyp = 'DBN';

  const invDate = new Date(inv.invoice_date);
  const formattedDate = `${String(invDate.getDate()).padStart(2, '0')}/${String(invDate.getMonth() + 1).padStart(2, '0')}/${invDate.getFullYear()}`;

  const sellerStateCode = inv.company_gstin ? inv.company_gstin.substring(0, 2) : '30';
  const buyerStateCode = inv.customer_gstin ? inv.customer_gstin.substring(0, 2) : sellerStateCode;

  const extractPin = (address) => {
    if (!address) return 0;
    const match = address.match(/\b(\d{6})\b/);
    return match ? parseInt(match[1], 10) : 0;
  };

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
      Dt: formattedDate,
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

/**
 * Generate IRN. TaxPro handles the NIC encryption.
 */
async function generateIRN(companyId, invoiceData) {
  const config = getConfig();
  const { authToken } = await authenticate(companyId);
  const payload = buildEInvoicePayload(invoiceData);

  /*
  const response = await fetch(`${config.baseUrl}/einvoice/GenerateIRN`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'Gstin': config.gstin,
    },
    body: JSON.stringify([payload]), // Might expect array depending on Taxpro API
  });
  const data = await response.json();
  if(!data.success) throw new Error(data.error);
  return { irn: data.Irn, ackNumber: data.AckNo, ackDate: data.AckDt, signedQr: data.SignedQRCode, signedInvoice: data.SignedInvoice };
  */

  // Mock for now
  return {
    irn: `IRN-TAXPRO-MOCK-${invoiceData.invoice.id}`,
    ackNumber: Math.floor(Math.random() * 1000000),
    ackDate: new Date().toISOString(),
    signedQr: 'mock_qr_taxpro',
    signedInvoice: 'mock_signed_taxpro_invoice'
  };
}

/**
 * Generate E-Way Bill by passing the IRN to TaxPro.
 */
async function generateEwayBill(companyId, irn, transportArgs) {
  const config = getConfig();
  const { authToken } = await authenticate(companyId);

  const payload = {
    Irn: irn,
    Distance: transportArgs.distance_km || 0,
    TransMode: transportArgs.transport_mode || '1',
    TransId: transportArgs.transporter_id || '',
    TransName: transportArgs.transporter_name || '',
    VehNo: transportArgs.vehicle_no || '',
    VehType: 'R' // Regular
  };

  /*
  const response = await fetch(`${config.baseUrl}/ewaybill/GenerateByIRN`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'Gstin': config.gstin,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if(!data.success) throw new Error(data.error);
  return { ewbNo: data.EwbNo, ewbDt: data.EwbDt, validUpto: data.EwbValidTill };
  */

  // Mock for now
  if (!irn) throw new Error('IRN is required to generate E-Way bill');
  
  return {
    ewbNo: `EWB-TAXPRO-${Date.now()}`,
    ewbDt: new Date().toISOString(),
    validUpto: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  };
}

async function cancelIRN(companyId, irn, reason, remark) {
  const config = getConfig();
  const { authToken } = await authenticate(companyId);
  // POST to taxpro cancel IRN endpoint...
  return { cancelled: true, cancelDate: new Date().toISOString() };
}

async function cancelEwayBill(companyId, ewbNo, reason, remark) {
  const config = getConfig();
  const { authToken } = await authenticate(companyId);
  // POST to taxpro cancel EwayBill endpoint...
  return { cancelled: true, cancelDate: new Date().toISOString() };
}

function isTaxproEnabled() {
  return !!(
    process.env.TAXPRO_CLIENT_ID &&
    process.env.TAXPRO_CLIENT_SECRET &&
    process.env.TAXPRO_USERNAME_GSTIN
  );
}

module.exports = {
  authenticate,
  generateIRN,
  generateEwayBill,
  cancelIRN,
  cancelEwayBill,
  buildEInvoicePayload,
  isTaxproEnabled,
};
