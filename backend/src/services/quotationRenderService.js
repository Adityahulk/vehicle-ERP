const fs = require('fs');
const path = require('path');
const {
  findCompanyAsset,
  fileToDataUri,
  tryLegacyUploadUrl,
  formatPaise,
  formatDate,
  amountInWordsFromPaise,
  esc,
} = require('./invoiceTemplateRender');

const TPL_PATH = path.join(__dirname, '..', 'templates', 'quotation_template.html');

const DEFAULT_TERMS = `1. This quotation is valid until the date shown under "Valid Until" above.
2. Prices are subject to change without prior notice after validity period.
3. GST will be charged as applicable at the time of billing.
4. Delivery period: 7-15 working days from the date of order confirmation.
5. 50% advance required to confirm the booking.`;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (24 * 60 * 60 * 1000));
}

function buildItemRows(items, primaryColor) {
  const hasIgst = items.some((i) => Number(i.igst_amount) > 0);
  return items.map((it, idx) => {
    const rowClass = it.item_type === 'vehicle' ? 'row-vehicle' : '';
    const disc = Number(it.discount_amount) > 0 ? formatPaise(it.discount_amount) : '—';
    const taxable = Number(it.amount) - Number(it.cgst_amount) - Number(it.sgst_amount) - Number(it.igst_amount);
    const gstPct = hasIgst
      ? `${Number(it.igst_rate)}%`
      : `${Number(it.cgst_rate) + Number(it.sgst_rate)}%`;
    const gstAmt = hasIgst ? formatPaise(it.igst_amount) : formatPaise(Number(it.cgst_amount) + Number(it.sgst_amount));
    return `<tr class="${rowClass}">
      <td class="center">${idx + 1}</td>
      <td>${esc(it.description)}</td>
      <td class="center">${esc(it.hsn_code || '')}</td>
      <td class="center">${it.quantity}</td>
      <td class="num">₹${formatPaise(it.unit_price)}</td>
      <td class="num">${disc}</td>
      <td class="num">₹${formatPaise(taxable)}</td>
      <td class="center">${gstPct}</td>
      <td class="num">₹${gstAmt}</td>
      <td class="num"><strong>₹${formatPaise(it.amount)}</strong></td>
    </tr>`;
  }).join('');
}

function buildTermsList(termsText, _validUntilFormatted) {
  const raw = (termsText && String(termsText).trim())
    ? String(termsText).trim()
    : DEFAULT_TERMS;
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const t = line.replace(/^\d+\.\s*/, '');
    return `<li>${esc(t)}</li>`;
  }).join('');
}

/**
 * @param {object} bundle — quotation, items[], company, branch, customer|null, vehicle|null, vehicleOverride object, preparedByName, logo_url, signature_url
 */
function buildQuotationHtml(bundle) {
  const q = bundle.quotation;
  const items = bundle.items || [];
  const co = bundle.company || {};
  const br = bundle.branch || {};
  const primary = '#1a56db';

  const companyId = q.company_id;
  let logoUri = '';
  const logoPath = tryLegacyUploadUrl(bundle.logo_url || co.logo_url) || findCompanyAsset(companyId, 'logo');
  if (logoPath) logoUri = fileToDataUri(logoPath);
  let sigUri = '';
  const sigPath = tryLegacyUploadUrl(bundle.signature_url || co.signature_url) || findCompanyAsset(companyId, 'signature');
  if (sigPath) sigUri = fileToDataUri(sigPath);

  const logoBlock = logoUri
    ? `<img class="logo" src="${logoUri}" alt="Logo" />`
    : '';

  const vo = bundle.vehicleOverride || {};
  const v = bundle.vehicle || {};
  const makeModel = [v.make || vo.make, v.model || vo.model, v.variant || vo.variant].filter(Boolean).join(' ').trim() || '—';
  const vehColor = v.color || vo.color || '—';
  const vehYear = v.year || vo.year || '—';
  const chassis = v.chassis_number || 'To be allocated';
  const exRow = items.find((i) => i.item_type === 'vehicle');
  const exShow = exRow ? formatPaise(exRow.unit_price * exRow.quantity) : '—';

  const custName = q.customer_id && bundle.customer
    ? bundle.customer.name
    : (q.customer_name_override || '—');
  const phone = q.customer_id && bundle.customer
    ? bundle.customer.phone
    : q.customer_phone_override;
  const email = q.customer_id && bundle.customer
    ? bundle.customer.email
    : q.customer_email_override;
  const addr = q.customer_id && bundle.customer
    ? (bundle.customer.address || '')
    : (q.customer_address_override || '');
  const contact = [phone, email].filter(Boolean).join(' | ') || '—';

  const validUntil = formatDate(q.valid_until_date);
  const dLeft = daysUntil(q.valid_until_date);
  const validClass = dLeft !== null && dLeft >= 0 && dLeft <= 3 ? 'valid-warn' : '';

  let tpl = fs.readFileSync(TPL_PATH, 'utf8');
  const discountRow = Number(q.discount_amount) > 0
    ? '<tr><td>Overall discount</td><td>− ₹' + formatPaise(q.discount_amount) + '</td></tr>'
    : '';

  const notesBlock = (q.customer_notes && String(q.customer_notes).trim())
    ? `<div class="notes-section"><h4>Notes</h4><div class="notes-body">${esc(q.customer_notes)}</div></div>`
    : '';

  const sigImg = sigUri
    ? `<img src="${sigUri}" alt="Signature" />`
    : '<div style="height:36px"></div>';

  const repl = {
    PRIMARY_COLOR: primary,
    LOGO_BLOCK: logoBlock,
    COMPANY_NAME: esc(co.name || ''),
    BRANCH_NAME: esc(br.name || ''),
    BRANCH_ADDRESS: esc(br.address || ''),
    BRANCH_PHONE: esc(br.phone || ''),
    BRANCH_EMAIL: esc(br.email || co.email || ''),
    COMPANY_GSTIN: esc(co.gstin || '—'),
    QUOTATION_NUMBER: esc(q.quotation_number),
    QUOTATION_DATE: formatDate(q.quotation_date),
    VALID_UNTIL: validUntil,
    VALID_CLASS: validClass,
    PREPARED_BY: esc(bundle.preparedByName || '—'),
    CUSTOMER_NAME: esc(custName),
    CUSTOMER_CONTACT: esc(contact),
    CUSTOMER_ADDRESS: esc(addr),
    VEH_MAKE_MODEL: esc(makeModel),
    VEH_COLOR: esc(String(vehColor)),
    VEH_YEAR: esc(String(vehYear)),
    CHASSIS: esc(chassis),
    EX_SHOWROOM: exShow === '—' ? '—' : `₹${exShow}`,
    ITEM_ROWS: buildItemRows(items, primary),
    SUBTOTAL: `₹${formatPaise(q.subtotal)}`,
    DISCOUNT_ROW: discountRow,
    CGST: `₹${formatPaise(q.cgst_amount)}`,
    SGST: `₹${formatPaise(q.sgst_amount)}`,
    IGST: `₹${formatPaise(q.igst_amount)}`,
    GRAND_TOTAL: `₹${formatPaise(q.total)}`,
    AMOUNT_WORDS: esc(amountInWordsFromPaise(q.total)),
    NOTES_BLOCK: notesBlock,
    TERMS_LIST: buildTermsList(q.terms_and_conditions, validUntil),
    COMPANY_FOOTER: esc(co.footer_text || ''),
    SIGNATURE_IMG: sigImg,
  };

  let html = tpl;
  Object.entries(repl).forEach(([k, v]) => {
    html = html.split(`{{${k}}}`).join(v);
  });
  return html;
}

module.exports = { buildQuotationHtml, DEFAULT_TERMS };
