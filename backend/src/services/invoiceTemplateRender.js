const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const { DEFAULT_LAYOUT } = require('../constants/invoiceLayoutDefaults');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'invoice-html');
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
/** Repo: backend/assets/invoice-signatures (not under src/) */
const PRESET_SIGN_DIR = path.join(__dirname, '..', '..', 'assets', 'invoice-signatures');
const PRESET_LOGO_DIR = path.join(__dirname, '..', '..', 'assets', 'invoice-logos');

/** Preset branding for server-side invoice PDF rendering. */
const LOGO_PRESET_FILES = {
  mvg_group: 'mvg-group-clean.png',
};

/** Built-in signature scans (Rudra Green Legender — Proprietor; Mavidya — Director). */
const SIGNATURE_PRESET_FILES = {
  rudra_proprietor: 'rudra-green-legender-proprietor.png',
  mavidya_director: 'mavidya-director.png',
};

const GST_STATE_NAMES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh',
};

function stateNameFromGstin(gstin) {
  if (!gstin || String(gstin).length < 2) return '—';
  const code = String(gstin).slice(0, 2);
  return GST_STATE_NAMES[code] || `State code ${code}`;
}

function mergeLayout(templateRow) {
  const raw = templateRow?.layout_config;
  const cfg = typeof raw === 'object' && raw && !Array.isArray(raw) ? raw : {};
  const merged = { ...DEFAULT_LAYOUT, ...cfg };
  const pc = String(merged.primary_color || '').trim();
  const pcLo = pc.toLowerCase();
  if (!pc || pcLo === '#000' || pcLo === '#000000') {
    merged.primary_color = DEFAULT_LAYOUT.primary_color;
  }
  if (typeof merged.bank_details === 'string') {
    merged.bank_details = merged.bank_details
      .replace(/\r\n/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n');
  }
  return merged;
}

/** Non-empty per-template fields override company snapshot on PDF/HTML (all invoice layouts). */
function applyLayoutSellerOverrides(inv, L) {
  if (!inv || typeof inv !== 'object') return inv;
  const next = { ...inv };
  const apply = (layoutVal, key) => {
    if (layoutVal == null) return;
    const s = typeof layoutVal === 'string' ? layoutVal.trim() : String(layoutVal).trim();
    if (s) next[key] = typeof layoutVal === 'string' ? layoutVal.trim() : s;
  };
  apply(L.seller_name_override, 'company_name');
  apply(L.seller_address_override, 'company_address');
  apply(L.seller_phone_override, 'company_phone');
  apply(L.seller_email_override, 'company_email');
  apply(L.seller_gstin_override, 'company_gstin');
  return next;
}

function esc(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** IRN QR for PDF/HTML: prefer `irn_qr_data_uri` from attachIrnQrDataUri; else signed_qr via fallback URL. */
function irnQrImgHtml(inv, opts = {}) {
  if (!inv?.irn) return '';
  const payload = inv.signed_qr != null ? String(inv.signed_qr).trim() : '';
  if (!inv.irn_qr_data_uri && !payload) return '';
  const src = inv.irn_qr_data_uri
    || `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(payload)}`;
  const br = opts.leadingBreak === false ? '' : '<br/>';
  return `${br}<img src="${src}" style="width:90px;height:90px;margin-top:6px" alt="" />`;
}

function formatPaise(paise) {
  return (Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** DD/MM/YYYY — matches typical Indian tax invoice printouts */
function formatDateDdMmYyyy(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const dd = String(x.getDate()).padStart(2, '0');
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const yyyy = x.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fileToDataUri(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return '';
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
  const b64 = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function findCompanyAsset(companyId, kind) {
  const sub = kind === 'logo' ? 'logos' : 'signatures';
  const dir = path.join(UPLOADS_ROOT, sub, companyId);
  if (!fs.existsSync(dir)) return null;
  const prefix = kind === 'logo' ? 'logo' : 'signature';
  const files = fs.readdirSync(dir).filter((f) => {
    if (f.startsWith('.')) return false;
    return f.toLowerCase().startsWith(`${prefix}.`);
  });
  if (files.length === 0) return null;
  let bestPath = null;
  let bestMtime = -1;
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const m = fs.statSync(full).mtimeMs;
      if (m >= bestMtime) {
        bestMtime = m;
        bestPath = full;
      }
    } catch {
      /* skip broken symlink etc. */
    }
  }
  return bestPath;
}

function tryLegacyUploadUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const rel = url.replace(/^\/+/, '').replace(/^uploads\/?/, '');
  const abs = path.join(UPLOADS_ROOT, rel);
  const normalized = path.normalize(abs);
  if (!normalized.startsWith(path.normalize(UPLOADS_ROOT))) return null;
  return fs.existsSync(normalized) ? normalized : null;
}

function resolveLogoDataUri(companyId, invoice, layout) {
  if (!layout.show_logo) return '';
  const raw = layout.logo_asset;
  const asset = typeof raw === 'string' ? raw.trim() : '';
  const useCompanyUpload = !asset || asset.toLowerCase() === 'company_upload';
  if (!useCompanyUpload && LOGO_PRESET_FILES[asset]) {
    const presetPath = path.join(PRESET_LOGO_DIR, LOGO_PRESET_FILES[asset]);
    if (fs.existsSync(presetPath)) return fileToDataUri(presetPath);
  }
  const p = tryLegacyUploadUrl(invoice.logo_url) || findCompanyAsset(companyId, 'logo');
  return p ? fileToDataUri(p) : '';
}

function resolveSignatureDataUri(companyId, invoice, layout) {
  if (!layout.show_signature) return '';
  const raw = layout.signature_asset;
  const asset = typeof raw === 'string'
    ? raw.trim()
    : (raw != null && typeof raw !== 'object' ? String(raw).trim() : '');
  const useCompanyUpload = !asset || asset.toLowerCase() === 'company_upload';
  if (!useCompanyUpload && SIGNATURE_PRESET_FILES[asset]) {
    const presetPath = path.join(PRESET_SIGN_DIR, SIGNATURE_PRESET_FILES[asset]);
    if (fs.existsSync(presetPath)) return fileToDataUri(presetPath);
  }
  /** Prefer DB path (matches last upload); else newest signature.* on disk (avoids stale second extension). */
  const p = tryLegacyUploadUrl(invoice.signature_url) || findCompanyAsset(companyId, 'signature');
  return p ? fileToDataUri(p) : '';
}

function resolveLogoSignatureDataUri(companyId, invoice, layout) {
  const logo = resolveLogoDataUri(companyId, invoice, layout);
  const signature = resolveSignatureDataUri(companyId, invoice, layout);
  return { logo, signature };
}

async function fetchInvoiceTemplateRow(companyId, templateId) {
  if (templateId) {
    const { rows } = await query(
      `SELECT * FROM invoice_templates WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [templateId, companyId],
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await query(
    `SELECT * FROM invoice_templates WHERE company_id = $1 AND is_default = TRUE AND is_deleted = FALSE LIMIT 1`,
    [companyId],
  );
  return rows[0] || { template_key: 'standard', layout_config: {} };
}

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? ` ${ones[n % 10]}` : '');
}

function belowThousand(n) {
  if (n < 100) return belowHundred(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return `${ones[h]} Hundred${r ? ` ${belowHundred(r)}` : ''}`.trim();
}

function indianNumberWords(n) {
  if (n === 0) return 'Zero';
  let num = Math.floor(Math.abs(n));
  const parts = [];
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (crore) parts.push(`${belowHundred(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (num) parts.push(belowThousand(num));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function amountInWordsFromPaise(paise) {
  const p = Number(paise);
  const rupees = Math.floor(p / 100);
  const ps = Math.round(p % 100);
  let w = `Rupees ${indianNumberWords(rupees)}`;
  if (ps > 0) w += ` and ${belowHundred(ps)} Paise`;
  w += ' Only';
  return w;
}

function buildHeaderHtml(inv, L, logoBlock) {
  const style = L.header_style || 'left-aligned';
  const coBlock = `
    <div class="company-block">
      <div class="company-name">${esc(inv.company_name)}</div>
      <p>${esc(inv.company_address || '')}</p>
      <p>Phone: ${esc(inv.company_phone || '')} | Email: ${esc(inv.company_email || '')}</p>
      <p><strong>GSTIN:</strong> ${esc(inv.company_gstin || '—')}</p>
    </div>`;
  const barcodeHtml = inv.invoice_barcode_data_uri
    ? `<div style="margin-top:10px;text-align:right"><img src="${inv.invoice_barcode_data_uri}" alt="" style="max-height:44px;max-width:240px;display:inline-block" /></div>`
    : '';
  const metaBlock = `
    <div class="header-invoice-meta">
      <div class="title-tax">${inv.irn ? 'e-TAX INVOICE' : 'TAX INVOICE'}</div>
      <table class="meta-table" style="margin-left:auto">
        <tr><td><strong>Invoice No.</strong></td><td>${esc(inv.invoice_number)}</td></tr>
        <tr><td><strong>Invoice Date</strong></td><td>${formatDate(inv.invoice_date)}</td></tr>
        <tr><td><strong>Payment Type</strong></td><td>${esc(inv.payment_type || (Number(inv.loan_amount) > 0 ? 'Credit' : 'Cash'))}</td></tr>
        <tr><td><strong>Due Date</strong></td><td>${formatDate(inv.loan_due_date || inv.invoice_date)}</td></tr>
        <tr><td><strong>Status</strong></td><td>${esc(String(inv.status || '').toUpperCase())}</td></tr>
      </table>
      ${barcodeHtml}
    </div>`;

  if (style === 'centered') {
    return `<div class="header-centered" style="text-align:center;margin-bottom:8px">
      ${logoBlock}
      ${coBlock.replace('class="company-block"', 'class="company-block" style="text-align:center"')}
      <div style="margin-top:14px;text-align:center">${metaBlock.replace('margin-left:auto', 'margin:0 auto')}</div>
    </div>`;
  }
  const left = `<div class="header-main" style="flex:1;min-width:0">${logoBlock}${coBlock}</div>`;
  const right = metaBlock.replace('class="header-invoice-meta"', 'class="header-invoice-meta" style="flex:0 0 230px;text-align:right"');
  if (style === 'two-column') {
    return `<div class="header-two-col" style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">${left}${right}</div>`;
  }
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;width:100%">${left}${right}</div>`;
}

function tradeMetaTr(label, valueHtml) {
  const inner = valueHtml === '' || valueHtml == null ? '&#160;' : valueHtml;
  return `<tr><td class="k">${esc(label)}</td><td>${inner}</td></tr>`;
}

/** Split bank details into two columns (--- line, blank paragraph, or RBL second bank). */
function splitBankTwoColumns(raw) {
  if (!raw || !String(raw).trim()) return ['', ''];
  const t = String(raw).trim();
  const byRule = t.split(/\n\s*---+?\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (byRule.length >= 2) return [byRule[0], byRule.slice(1).join('\n\n')];
  const paras = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) {
    const mid = Math.ceil(paras.length / 2);
    return [paras.slice(0, mid).join('\n\n'), paras.slice(mid).join('\n\n')];
  }
  const rblMatch = t.match(/\n(?=\s*RBL\b)/i);
  if (rblMatch && rblMatch.index > 0) {
    return [t.slice(0, rblMatch.index).trim(), t.slice(rblMatch.index + 1).trim()];
  }
  return [t, ''];
}

function buildTradeInvoiceHtml({ invoice: inv, items }, templateRow) {
  const L = mergeLayout(templateRow);
  const invN = applyLayoutSellerOverrides(inv, L);
  const tplPath = path.join(TEMPLATE_DIR, 'template_trade.html');
  let html = fs.readFileSync(tplPath, 'utf8');
  const companyId = invN.company_id;
  const { logo, signature } = resolveLogoSignatureDataUri(companyId, invN, L);
  const hasIgst = items.some((i) => Number(i.igst_amount) > 0);
  const barColor = String(L.primary_color || DEFAULT_LAYOUT.primary_color).trim();
  const logoBlock = logo
    ? `<img src="${logo}" alt=" " />`
    : '<span style="display:inline-block;min-height:56px">&#160;</span>';

  const emailSuffix = L.show_company_email === true && invN.company_email
    ? esc(` | Email: ${invN.company_email}`)
    : '';

  const coStateCode = invN.company_gstin ? String(invN.company_gstin).slice(0, 2) : '—';
  const coStateName = stateNameFromGstin(invN.company_gstin);
  const posStateCode = invN.customer_gstin ? String(invN.customer_gstin).slice(0, 2) : '—';
  const posStateName = invN.customer_gstin ? stateNameFromGstin(invN.customer_gstin) : '—';

  const partyLines = (name, addr, phone, gstin) => `
    <p><strong>${esc(name)}</strong></p>
    <p>${esc(addr || '').replace(/\n/g, '<br/>')}</p>
    <p><strong>POS:</strong> ${esc(posStateName)}</p>
    <p><strong>State Code:</strong> ${esc(posStateCode)}</p>
    <p>${phone ? esc(`Phone No: ${phone}`) : '&#160;'}</p>
    <p>${gstin ? esc(`GSTIN: ${gstin}`) : '&#160;'}</p>`;

  const shipToSame = invN.ship_to_same_as_billing !== false && L.ship_to_same_as_billing !== false;
  const shipName = invN.ship_to_name || invN.customer_name;
  const shipAddress = invN.ship_to_address || invN.customer_address;
  const shipPhone = invN.ship_to_phone || invN.customer_phone;
  const shipGstin = invN.ship_to_gstin || invN.customer_gstin;
  const shipInner = shipToSame
    ? partyLines(invN.customer_name, invN.customer_address, invN.customer_phone, invN.customer_gstin)
    : partyLines(shipName, shipAddress, shipPhone, shipGstin);

  const payType = invN.payment_type || (Number(invN.loan_amount) > 0 ? 'Credit' : 'Cash');
  const ddm = formatDateDdMmYyyy(invN.invoice_date);
  const salesExecHtml = L.sales_executive_label ? esc(L.sales_executive_label) : '';

  const metaLeft = [
    tradeMetaTr('Invoice No.', esc(invN.invoice_number)),
    tradeMetaTr('Bill Ref No.', ''),
    tradeMetaTr('Date', esc(ddm)),
    tradeMetaTr('Date', ''),
  ].join('');

  const metaRight = [
    tradeMetaTr('Sales Executive', salesExecHtml),
    tradeMetaTr('Payment Type', esc(payType)),
    tradeMetaTr('Date', esc(ddm)),
  ].join('');

  const vehicleNo = esc(invN.rto_number || invN.chassis_number || '—');
  const dest = esc(invN.branch_name || invN.customer_address?.split(',').pop()?.trim() || '—');
  const eway = esc(invN.eway_bill_no || '—');

  const unitLabel = 'Pcs';
  const itemsHead = hasIgst
    ? `<tr>
      <th rowspan="2" class="c">SlNo</th>
      <th rowspan="2">Item Description</th>
      <th rowspan="2" class="c">Qty</th>
      <th rowspan="2" class="c">Unit</th>
      <th rowspan="2" class="r">Basic Rate</th>
      <th rowspan="2" class="r">Gross Amount</th>
      <th rowspan="2" class="c">HSN/SAC</th>
      <th colspan="2" class="c">IGST</th>
      <th rowspan="2" class="r">Amount</th>
    </tr>
    <tr>
      <th class="c">Tax Per</th>
      <th class="r">Tax Amount</th>
    </tr>`
    : `<tr>
      <th class="c">SlNo</th>
      <th>Item Description</th>
      <th class="c">Qty</th>
      <th class="c">Unit</th>
      <th class="r">Basic Rate</th>
      <th class="r">Gross Amount</th>
      <th class="c">HSN/SAC</th>
      <th class="r">CGST</th>
      <th class="r">SGST</th>
      <th class="r">Amount</th>
    </tr>`;

  const itemsBody = items.map((item, idx) => {
    const gstRate = hasIgst ? Number(item.igst_rate) : Number(item.cgst_rate) + Number(item.sgst_rate);
    const gross = Number(item.unit_price) * Number(item.quantity);
    const igstPerCell = hasIgst      ? `${Number(item.igst_rate || 0).toFixed(2)}`
      : '';
    const taxCells = hasIgst
      ? `<td class="r">${igstPerCell}</td><td class="r">&#8377;${formatPaise(item.igst_amount)}</td>`
      : `<td class="r">&#8377;${formatPaise(item.cgst_amount)}</td><td class="r">&#8377;${formatPaise(item.sgst_amount)}</td>`;
    return `<tr>
      <td class="c">${idx + 1}</td>
      <td>${esc(item.description)}</td>
      <td class="r">${Number(item.quantity).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="c">${esc(unitLabel)}</td>
      <td class="r">&#8377;${formatPaise(item.unit_price)}</td>
      <td class="r">&#8377;${formatPaise(gross)}</td>
      <td class="c">${esc(item.hsn_code || '')}</td>
      ${taxCells}
      <td class="r"><strong>&#8377;${formatPaise(item.amount)}</strong></td>
    </tr>`;
  }).join('');

  const taxableTotal = Number(invN.subtotal) - Number(invN.discount);
  const first = items[0] || {};
  const cgstR = hasIgst ? 0 : (Number(first.cgst_rate) || 0);
  const sgstR = hasIgst ? 0 : (Number(first.sgst_rate) || 0);
  const igstR = hasIgst ? (Number(first.igst_rate) || 0) : 0;

  const taxSummaryRow = `<tr>
    <td class="r">&#8377;${formatPaise(taxableTotal)}</td>
    <td class="r">${cgstR ? `${cgstR}%` : '0'}</td>
    <td class="r">&#8377;${formatPaise(invN.cgst_amount)}</td>
    <td class="r">${sgstR ? `${sgstR}%` : '0'}</td>
    <td class="r">&#8377;${formatPaise(invN.sgst_amount)}</td>
    <td class="r">${igstR ? `${igstR}%` : '0'}</td>
    <td class="r">&#8377;${formatPaise(invN.igst_amount)}</td>
  </tr>`;

  const qtySum = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const totalsLeft = `
    <p class="qty-note">No of Items: ${items.length} &nbsp;&nbsp; Items Total Qty: ${qtySum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
    <table class="tax-mini">
      <thead><tr><th>Taxable Amt</th><th>CGST %</th><th>CGST Amt</th><th>SGST %</th><th>SGST Amt</th><th>IGST %</th><th>IGST Amt</th></tr></thead>
      <tbody>${taxSummaryRow}</tbody>
    </table>`;

  const preTax = 0;
  const postTax = 0;
  const cess = 0;
  const tcs = 0;
  const roundOff = 0;
  const totalsRight = `
    <div class="tot-stack">
      <div class="r"><span>Total Amount</span><span>&#8377;${formatPaise(invN.subtotal)}</span></div>
      <div class="r"><span>Discount Amount</span><span>&#8377;${formatPaise(invN.discount)}</span></div>
      <div class="r"><span>Pre Tax</span><span>&#8377;${formatPaise(preTax)}</span></div>
      <div class="r"><span>Taxable Amount</span><span>&#8377;${formatPaise(taxableTotal)}</span></div>
      <div class="r"><span>IGST Rate</span><span>${igstR ? Number(igstR).toFixed(2) : '0.00'}</span></div>
      <div class="r"><span>IGST Amt</span><span>&#8377;${formatPaise(invN.igst_amount)}</span></div>
      <div class="r"><span>Cess Amount</span><span>&#8377;${formatPaise(cess)}</span></div>
      <div class="r"><span>Post Tax</span><span>&#8377;${formatPaise(postTax)}</span></div>
      <div class="r"><span>TCS</span><span>&#8377;${formatPaise(tcs)}</span></div>
      <div class="r"><span>Round Off Amount</span><span>&#8377;${formatPaise(roundOff)}</span></div>
      <div class="r"><span>Grand Total</span><span>&#8377; ${formatPaise(invN.total)}</span></div>
    </div>`;

  const termsBlock = L.show_terms && L.terms_text
    ? `<strong>Terms &amp; Condition</strong><div style="margin-top:6px;white-space:pre-wrap;">${esc(L.terms_text).replace(/\n/g, '<br/>')}</div>`
    : '&#160;';

  let bankColLeft = '&#160;';
  let bankColRight = '&#160;';
  if (L.show_bank_details && L.bank_details) {
    const [b1, b2] = splitBankTwoColumns(L.bank_details);
    bankColLeft = b1 ? esc(b1).replace(/\n/g, '<br/>') : '&#160;';
    bankColRight = b2 ? esc(b2).replace(/\n/g, '<br/>') : '&#160;';
  }

  const signImg = signature
    ? `<img src="${signature}" alt=" " />`
    : '<div style="min-height:48px">&#160;</div>';

  const einvoiceBlock = invN.irn
    ? `<div class="einv-box">
        <strong>E-INVOICE (IRN)</strong><br/>
        <span style="font-family:monospace;word-break:break-all;font-size:9px;">${esc(invN.irn)}</span>
        ${irnQrImgHtml(invN)}
       </div>`
    : '';

  const qrBlock = !invN.irn && L.show_qr_code
    ? '<div style="margin-top:8px;text-align:center;font-size:9px;border:1px solid #000;padding:8px;">QR</div>'
    : '';

  const loanBlock = L.show_loan_summary && invN.loan_amount != null && Number(invN.loan_amount) > 0
    ? `<div class="loan-box"><strong>Loan summary</strong><br/>
        Bank: ${esc(invN.loan_bank_name || '—')}<br/>
        Amount: &#8377;${formatPaise(invN.loan_amount)} · EMI: &#8377;${formatPaise(invN.loan_emi_amount || 0)} · Tenure: ${esc(invN.loan_tenure_months || '—')} months
       </div>`
    : '';

  const subnote = L.computer_gen_subnote ? esc(L.computer_gen_subnote) : '';
  const computerGenLine = subnote
    ? `This is a computer-generated invoice. ${subnote}`
    : 'This is a computer-generated invoice.';
  const footerExtra = L.footer_text
    ? `<p class="page-foot" style="margin-top:4px;">${esc(L.footer_text)}</p>`
    : '';

  const invoiceBarcodeRow = invN.invoice_barcode_data_uri
    ? `<table class="inv" style="margin:0;border:1px solid #000;border-top:0;border-collapse:collapse;width:100%"><tr><td style="text-align:center;padding:6px 8px;vertical-align:middle"><img src="${invN.invoice_barcode_data_uri}" alt="" style="max-height:38px;max-width:92%;display:inline-block" /></td></tr></table>`
    : '';

  const map = {
    PRIMARY_COLOR: esc(barColor),
    ORIGINAL_LABEL: esc(L.original_copy_label || 'ORIGINAL FOR RECIPIENT'),
    LOGO_BLOCK: logoBlock,
    COMPANY_NAME: esc(invN.company_name),
    COMPANY_ADDRESS: esc(invN.company_address || '').replace(/\n/g, '<br/>'),
    COMPANY_PHONE: esc(invN.company_phone || '—'),
    COMPANY_EMAIL_SUFFIX: emailSuffix,
    COMPANY_GSTIN: esc(invN.company_gstin || '—'),
    COMPANY_STATE_CODE: esc(coStateCode),
    COMPANY_STATE_NAME: esc(coStateName),
    META_LEFT: metaLeft,
    META_RIGHT: metaRight,
    EWAY: eway,
    VEHICLE_NO: vehicleNo,
    DESTINATION: dest,
    CUSTOMER_NAME: esc(invN.customer_name),
    CUSTOMER_ADDRESS: esc(invN.customer_address || '').replace(/\n/g, '<br/>'),
    CUSTOMER_PHONE: invN.customer_phone ? esc(`Phone No: ${invN.customer_phone}`) : '&#160;',
    CUSTOMER_GSTIN_LINE: invN.customer_gstin ? esc(`GSTIN: ${invN.customer_gstin}`) : '&#160;',
    POS_STATE_NAME: esc(posStateName),
    POS_STATE_CODE: esc(posStateCode),
    SHIP_TO_BLOCK: shipInner,
    LOAN_BLOCK: loanBlock,
    ITEMS_HEAD: itemsHead,
    ITEMS_BODY: itemsBody,
    TOTALS_LEFT: totalsLeft,
    TOTALS_RIGHT: totalsRight,
    AMOUNT_WORDS: esc(amountInWordsFromPaise(invN.total).toUpperCase()),
    TERMS_BLOCK: termsBlock,
    BANK_COL_LEFT: bankColLeft,
    BANK_COL_RIGHT: bankColRight,
    SIGNATURE_IMG: signImg,
    SIGNATORY_TITLE: esc(L.signatory_title || 'Authorised Signatory'),
    EINVOICE_BLOCK: einvoiceBlock,
    QR_BLOCK: qrBlock,
    COMPUTER_GEN_LINE: computerGenLine,
    FOOTER_EXTRA: footerExtra,
    INVOICE_BARCODE_ROW: invoiceBarcodeRow,
  };

  for (const [k, v] of Object.entries(map)) {
    html = html.split(`__${k}__`).join(v);
  }
  return html;
}

function buildStandardInvoiceHtml({ invoice: inv, items }, templateRow) {
  const L = mergeLayout(templateRow);
  const key = templateRow?.template_key === 'simple' ? 'simple' : templateRow?.template_key === 'trade' ? 'trade' : 'standard';
  if (key === 'trade') {
    return buildTradeInvoiceHtml({ invoice: inv, items }, templateRow);
  }
  const invN = applyLayoutSellerOverrides(inv, L);
  const tplPath = path.join(TEMPLATE_DIR, key === 'simple' ? 'template_simple.html' : 'template_standard.html');
  let html = fs.readFileSync(tplPath, 'utf8');

  const companyId = invN.company_id;
  const { logo, signature } = resolveLogoSignatureDataUri(companyId, invN, L);
  const hasIgst = items.some((i) => Number(i.igst_amount) > 0);
  const font = L.font === 'serif' ? "Georgia, 'Times New Roman', serif" : "'Segoe UI', system-ui, sans-serif";

  const logoBlock = logo
    ? `<div style="width:220px;height:120px;overflow:hidden;margin-bottom:8px;background:#f8fafc;border-radius:4px;padding:4px;">
         <img src="${logo}" alt="Logo" style="width:100%;height:100%;display:block;object-fit:contain;object-position:center;" />
       </div>`
    : '';

  const vehicleInner = (L.show_vehicle_details_block !== false) && invN.chassis_number
    ? `<div class="party"><h4>Vehicle Details</h4>
        <p>${esc([invN.vehicle_make, invN.vehicle_model, invN.vehicle_variant].filter(Boolean).join(' '))}</p>
        <p>Chassis: ${esc(invN.chassis_number)}</p>
        <p>Engine: ${esc(invN.engine_number || '—')}</p>
        <p>Color: ${esc(invN.vehicle_color || '—')} · Year: ${esc(invN.vehicle_year || '—')}</p>
       </div>`
    : '<div></div>';

  const vehicleSimple = (L.show_vehicle_details_block !== false) && invN.chassis_number
    ? `<div class="sub"><strong>Vehicle:</strong> ${esc([invN.vehicle_make, invN.vehicle_model].filter(Boolean).join(' '))} · Chassis ${esc(invN.chassis_number)}</div>`
    : '';

  let itemsHead;
  let itemsBody;
  let itemsHeadSimple;
  let itemsBodySimple;

  if (key === 'standard') {
    itemsHead = hasIgst
      ? `<tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th class="num">Unit Price</th><th class="num">Disc.</th><th class="num">Taxable</th><th class="num">GST%</th><th class="num">IGST</th><th class="num">Total</th></tr>`
      : `<tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th class="num">Unit Price</th><th class="num">Disc.</th><th class="num">Taxable</th><th class="num">GST%</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total</th></tr>`;

    itemsBody = items.map((item, idx) => {
      const gstRate = hasIgst ? Number(item.igst_rate) : Number(item.cgst_rate) + Number(item.sgst_rate);
      const taxable = Number(item.amount) - Number(item.cgst_amount) - Number(item.sgst_amount) - Number(item.igst_amount);
      const disc = 0;
      const taxCol = hasIgst
        ? `<td class="num">${formatPaise(item.igst_amount)}</td>`
        : `<td class="num">${formatPaise(item.cgst_amount)}</td><td class="num">${formatPaise(item.sgst_amount)}</td>`;
      return `<tr>
        <td>${idx + 1}</td>
        <td>${esc(item.description)}</td>
        <td>${esc(item.hsn_code || '')}</td>
        <td>${item.quantity}</td>
        <td class="num">₹${formatPaise(item.unit_price)}</td>
        <td class="num">₹${formatPaise(disc)}</td>
        <td class="num">₹${formatPaise(taxable)}</td>
        <td class="num">${gstRate}%</td>
        ${taxCol}
        <td class="num"><strong>₹${formatPaise(item.amount)}</strong></td>
      </tr>`;
    }).join('');
  } else {
    itemsHeadSimple = `<tr><th>#</th><th>Description</th><th>Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>`;
    itemsBodySimple = items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(item.description)}</td>
        <td>${item.quantity}</td>
        <td class="r">₹${formatPaise(item.unit_price)}</td>
        <td class="r">₹${formatPaise(item.amount)}</td>
      </tr>`).join('');
  }

  const totalsRows = `
    <tr><td>Subtotal</td><td class="num">₹${formatPaise(invN.subtotal)}</td></tr>
    ${Number(invN.discount) > 0 ? `<tr><td>Discount</td><td class="num" style="color:#b91c1c">- ₹${formatPaise(invN.discount)}</td></tr>` : ''}
    ${Number(invN.cgst_amount) > 0 ? `<tr><td>CGST</td><td class="num">₹${formatPaise(invN.cgst_amount)}</td></tr>` : ''}
    ${Number(invN.sgst_amount) > 0 ? `<tr><td>SGST</td><td class="num">₹${formatPaise(invN.sgst_amount)}</td></tr>` : ''}
    ${Number(invN.igst_amount) > 0 ? `<tr><td>IGST</td><td class="num">₹${formatPaise(invN.igst_amount)}</td></tr>` : ''}
    <tr class="grand"><td>GRAND TOTAL</td><td class="num">₹${formatPaise(invN.total)}</td></tr>`;

  const totalsRowsSimple = `
    <tr><td>Subtotal</td><td class="r">₹${formatPaise(invN.subtotal)}</td></tr>
    ${Number(invN.discount) > 0 ? `<tr><td>Discount</td><td class="r">-₹${formatPaise(invN.discount)}</td></tr>` : ''}
    ${Number(invN.cgst_amount) > 0 ? `<tr><td>CGST</td><td class="r">₹${formatPaise(invN.cgst_amount)}</td></tr>` : ''}
    ${Number(invN.sgst_amount) > 0 ? `<tr><td>SGST</td><td class="r">₹${formatPaise(invN.sgst_amount)}</td></tr>` : ''}
    ${Number(invN.igst_amount) > 0 ? `<tr><td>IGST</td><td class="r">₹${formatPaise(invN.igst_amount)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="r">₹${formatPaise(invN.total)}</td></tr>`;

  const termsBlock = L.show_terms && L.terms_text
    ? `<div class="terms"><strong>Terms &amp; conditions</strong><br/>${esc(L.terms_text)}</div>`
    : '';

  const bankBlock = L.show_bank_details && L.bank_details
    ? `<div class="terms" style="margin-top:10px"><strong>Bank details</strong><br/>${esc(L.bank_details).replace(/\n/g, '<br/>')}</div>`
    : '';

  const signTitle = esc(L.signatory_title || 'Authorised Signatory');
  const signBlock = L.show_signature
    ? `<p style="font-size:10px">For <strong>${esc(invN.company_name)}</strong></p>
       <div style="min-height:36px">${signature ? `<img src="${signature}" alt="Signature" />` : ''}</div>
       <p style="font-size:10px;border-top:1px solid #333;padding-top:4px">${signTitle}</p>`
    : `<p style="font-size:10px">For <strong>${esc(invN.company_name)}</strong></p><p style="font-size:10px">${signTitle}</p>`;

  const signSimple = L.show_signature
    ? `<div>For ${esc(invN.company_name)}</div>${signature ? `<img src="${signature}" alt="sig" />` : '<div style="height:36px"></div>'}<div>${signTitle}</div>`
    : `<div>For ${esc(invN.company_name)}</div><div>${signTitle}</div>`;

  const einvoiceBlock = invN.irn
    ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin-bottom:12px;">
        <p style="font-size:9px;color:#16a34a;font-weight:600;">E-INVOICE (IRN)</p>
        <p style="font-size:10px;font-family:monospace;word-break:break-all;">${esc(invN.irn)}</p>
        ${irnQrImgHtml(invN, { leadingBreak: false })}
       </div>`
    : '';

  const qrBlock = !invN.irn && L.show_qr_code
    ? '<div style="margin-top:12px;text-align:center;color:#94a3b8;font-size:9px;">QR placeholder</div>'
    : '';

  const loanBlock = L.show_loan_summary && invN.loan_amount != null && Number(invN.loan_amount) > 0
    ? `<div class="loan-box"><strong>Loan summary</strong><br/>
        Bank: ${esc(invN.loan_bank_name || '—')}<br/>
        Amount: ₹${formatPaise(invN.loan_amount)} · EMI: ₹${formatPaise(invN.loan_emi_amount || 0)} · Tenure: ${esc(invN.loan_tenure_months || '—')} months
       </div>`
    : '';

  const headerHtml = buildHeaderHtml(invN, L, logoBlock);

  const invoiceBarcodeSimple = invN.invoice_barcode_data_uri
    ? `<div style="text-align:center;margin:10px 0 6px"><img src="${invN.invoice_barcode_data_uri}" alt="" style="max-height:40px;max-width:100%" /></div>`
    : '';

  const map = {
    PRIMARY_COLOR: esc(L.primary_color || '#1a56db'),
    FONT_FAMILY: font,
    HEADER_HTML: headerHtml,
    COMPANY_NAME: esc(invN.company_name),
    COMPANY_ADDRESS: esc(invN.company_address || ''),
    COMPANY_GSTIN: esc(invN.company_gstin || '—'),
    COMPANY_PHONE: esc(invN.company_phone || ''),
    INVOICE_NUMBER: esc(invN.invoice_number),
    INVOICE_DATE: formatDate(invN.invoice_date),
    CUSTOMER_NAME: esc(invN.customer_name),
    CUSTOMER_ADDRESS: esc(invN.customer_address || ''),
    CUSTOMER_PHONE: invN.customer_phone ? esc(`Phone: ${invN.customer_phone}`) : '',
    CUSTOMER_GSTIN_LINE: invN.customer_gstin ? esc(`GSTIN: ${invN.customer_gstin}`) : '',
    VEHICLE_BLOCK: vehicleInner,
    VEHICLE_SIMPLE: vehicleSimple,
    ITEMS_HEAD: itemsHead || '',
    ITEMS_BODY: itemsBody || '',
    ITEMS_HEAD_SIMPLE: itemsHeadSimple || '',
    ITEMS_BODY_SIMPLE: itemsBodySimple || '',
    TOTALS_ROWS: totalsRows,
    TOTALS_ROWS_SIMPLE: totalsRowsSimple,
    AMOUNT_WORDS: esc(amountInWordsFromPaise(invN.total)),
    TERMS_BLOCK: termsBlock,
    BANK_BLOCK: bankBlock,
    SIGNATURE_BLOCK: signBlock,
    SIGNATURE_BLOCK_SIMPLE: signSimple,
    EINVOICE_BLOCK: key === 'standard' ? einvoiceBlock : '',
    QR_BLOCK: qrBlock,
    FOOTER_TEXT: esc(L.footer_text || ''),
    LOAN_BLOCK: key === 'standard' ? loanBlock : '',
    INVOICE_BARCODE_BLOCK: invoiceBarcodeSimple,
  };

  for (const [k, v] of Object.entries(map)) {
    html = html.split(`__${k}__`).join(v);
  }
  return html;
}

function buildDummyInvoiceData() {
  const invoice = {
    company_id: '00000000-0000-0000-0000-000000000000',
    invoice_number: 'MVG/25-26/102',
    invoice_date: new Date().toISOString().split('T')[0],
    payment_type: 'Cash',
    status: 'confirmed',
    subtotal: 45193810,
    discount: 0,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 2259690,
    total: 47453500,
    notes: 'Sample invoice for template preview.',
    company_name: 'MAVIDYA MVG PRADEEP GURU SYSTEM PRIVATE LIMITED',
    company_gstin: '07AASCM8531F1Z4',
    company_address: '1st Floor, 102, 52A, V81, Capital Tree, Jain Uniform Street, Nattu Sweets, Laxmi Nagar, Vijay Block, New Delhi - 110092',
    company_phone: '626006629',
    company_email: 'accounts@mavidya.com',
    logo_url: null,
    signature_url: null,
    customer_name: 'NAMO ENTERPRISES',
    customer_address: 'Word No 13 Kothi Main Road Royani Satna, Kothi Main Road Kothi, Satna - 485666',
    customer_phone: '7222988681',
    customer_gstin: '23DKJPP6431G1Z4',
    chassis_number: 'CHASSIS-DEMO-001',
    engine_number: 'ENG-DEMO-001',
    rto_number: 'MH40CT6648',
    eway_bill_no: '771550039887',
    branch_name: 'Satna',
    vehicle_make: 'Goods',
    vehicle_model: 'Vehicle line items',
    vehicle_variant: '',
    vehicle_color: '—',
    vehicle_year: 2025,
    irn: null,
    signed_qr: null,
    loan_bank_name: null,
    loan_amount: null,
    loan_emi_amount: null,
    loan_tenure_months: null,
    loan_due_date: null,
  };
  const items = [
    {
      description: 'SCHOOL VAN -1',
      hsn_code: '87031090',
      quantity: 1,
      unit_price: 16333333,
      cgst_rate: 0,
      sgst_rate: 0,
      igst_rate: 5,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 816667,
      amount: 17150000,
    },
    {
      description: 'E- RIKSHSAW MS',
      hsn_code: '87039010',
      quantity: 1,
      unit_price: 14349048,
      cgst_rate: 0,
      sgst_rate: 0,
      igst_rate: 5,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 717452,
      amount: 15066500,
    },
    {
      description: 'LOADER 4X6',
      hsn_code: '87039010',
      quantity: 1,
      unit_price: 14511429,
      cgst_rate: 0,
      sgst_rate: 0,
      igst_rate: 5,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 725571,
      amount: 15237000,
    },
  ];
  return { invoice, items };
}

module.exports = {
  mergeLayout,
  applyLayoutSellerOverrides,
  fetchInvoiceTemplateRow,
  buildStandardInvoiceHtml,
  buildDummyInvoiceData,
  formatPaise,
  formatDate,
  amountInWordsFromPaise,
  findCompanyAsset,
  fileToDataUri,
  tryLegacyUploadUrl,
  esc,
  resolveLogoDataUri,
  resolveSignatureDataUri,
  LOGO_PRESET_FILES,
  SIGNATURE_PRESET_FILES,
};
