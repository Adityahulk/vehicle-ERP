function formatPaise(paise) {
  return (Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildInvoiceHtml({ invoice, items }) {
  const inv = invoice;
  const hasIgst = items.some((i) => Number(i.igst_amount) > 0);

  const itemRows = items.map((item, idx) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${idx + 1}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${item.description}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${item.hsn_code || ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">₹${formatPaise(item.unit_price)}</td>
      ${hasIgst
        ? `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${Number(item.igst_rate)}%<br/>₹${formatPaise(item.igst_amount)}</td>`
        : `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${Number(item.cgst_rate)}%<br/>₹${formatPaise(item.cgst_amount)}</td>
           <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${Number(item.sgst_rate)}%<br/>₹${formatPaise(item.sgst_amount)}</td>`
      }
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">₹${formatPaise(item.amount)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color:#1a1a1a; font-size:12px; padding:30px; }
  .header { display:flex; justify-content:space-between; margin-bottom:20px; border-bottom:3px solid #1d4ed8; padding-bottom:15px; }
  .company-info h1 { font-size:20px; color:#1d4ed8; margin-bottom:4px; }
  .company-info p { color:#555; line-height:1.5; }
  .invoice-meta { text-align:right; }
  .invoice-meta h2 { font-size:22px; color:#1d4ed8; margin-bottom:8px; }
  .invoice-meta p { color:#555; line-height:1.6; }
  .parties { display:flex; justify-content:space-between; margin-bottom:20px; }
  .party-box { width:48%; padding:12px; background:#f8f9fa; border-radius:6px; }
  .party-box h3 { font-size:11px; text-transform:uppercase; color:#888; margin-bottom:6px; letter-spacing:0.5px; }
  .party-box p { line-height:1.6; }
  table { width:100%; border-collapse:collapse; margin-bottom:16px; }
  th { background:#1d4ed8; color:#fff; padding:8px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.3px; }
  th:first-child { border-radius:4px 0 0 0; }
  th:last-child { border-radius:0 4px 0 0; }
  .totals { display:flex; justify-content:flex-end; margin-bottom:24px; }
  .totals-table { width:280px; }
  .totals-table td { padding:4px 8px; }
  .totals-table .grand-total td { font-size:14px; font-weight:700; border-top:2px solid #1d4ed8; padding-top:8px; color:#1d4ed8; }
  .footer { display:flex; justify-content:space-between; border-top:1px solid #ddd; padding-top:16px; margin-top:20px; }
  .signature { text-align:right; }
  .signature img { max-height:50px; margin-bottom:4px; }
  .qr-placeholder { width:80px; height:80px; border:1px dashed #ccc; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999; }
</style>
</head>
<body>
  <div class="header">
    <div class="company-info">
      ${inv.logo_url ? `<img src="${inv.logo_url}" style="max-height:45px;margin-bottom:6px;" />` : ''}
      <h1>${inv.company_name || 'Company'}</h1>
      <p>${inv.company_address || ''}</p>
      <p>Phone: ${inv.company_phone || ''} | Email: ${inv.company_email || ''}</p>
      ${inv.company_gstin ? `<p><strong>GSTIN: ${inv.company_gstin}</strong></p>` : ''}
    </div>
    <div class="invoice-meta">
      <h2>TAX INVOICE</h2>
      <p><strong>Invoice #:</strong> ${inv.invoice_number}</p>
      <p><strong>Date:</strong> ${formatDate(inv.invoice_date)}</p>
      <p><strong>Status:</strong> ${inv.status.toUpperCase()}</p>
    </div>
  </div>

  <div class="parties">
    <div class="party-box">
      <h3>Bill To</h3>
      <p><strong>${inv.customer_name || ''}</strong></p>
      <p>${inv.customer_address || ''}</p>
      <p>${inv.customer_phone ? 'Phone: ' + inv.customer_phone : ''}</p>
      ${inv.customer_gstin ? `<p><strong>GSTIN: ${inv.customer_gstin}</strong></p>` : ''}
    </div>
    <div class="party-box">
      <h3>Ship From</h3>
      <p><strong>${inv.branch_name || ''}</strong></p>
      <p>${inv.branch_address || ''}</p>
      <p>${inv.branch_phone ? 'Phone: ' + inv.branch_phone : ''}</p>
      ${inv.chassis_number ? `<p>Vehicle: ${inv.vehicle_make || ''} ${inv.vehicle_model || ''} ${inv.vehicle_variant || ''}</p>
        <p>Chassis: ${inv.chassis_number} | Engine: ${inv.engine_number || ''}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:5%;text-align:center">#</th>
        <th style="width:30%">Description</th>
        <th style="width:10%;text-align:center">HSN</th>
        <th style="width:8%;text-align:center">Qty</th>
        <th style="width:12%;text-align:right">Unit Price</th>
        ${hasIgst
          ? '<th style="width:15%;text-align:right">IGST</th>'
          : '<th style="width:12%;text-align:right">CGST</th><th style="width:12%;text-align:right">SGST</th>'
        }
        <th style="width:15%;text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals">
    <table class="totals-table">
      <tr><td>Subtotal</td><td style="text-align:right">₹${formatPaise(inv.subtotal)}</td></tr>
      ${Number(inv.discount) > 0 ? `<tr><td>Discount</td><td style="text-align:right;color:#dc2626">- ₹${formatPaise(inv.discount)}</td></tr>` : ''}
      ${Number(inv.cgst_amount) > 0 ? `<tr><td>CGST</td><td style="text-align:right">₹${formatPaise(inv.cgst_amount)}</td></tr>` : ''}
      ${Number(inv.sgst_amount) > 0 ? `<tr><td>SGST</td><td style="text-align:right">₹${formatPaise(inv.sgst_amount)}</td></tr>` : ''}
      ${Number(inv.igst_amount) > 0 ? `<tr><td>IGST</td><td style="text-align:right">₹${formatPaise(inv.igst_amount)}</td></tr>` : ''}
      <tr class="grand-total"><td>Total</td><td style="text-align:right">₹${formatPaise(inv.total)}</td></tr>
    </table>
  </div>

  ${inv.notes ? `<p style="margin-bottom:16px;color:#555"><strong>Notes:</strong> ${inv.notes}</p>` : ''}

  <div class="footer">
    <div class="qr-placeholder">QR Code</div>
    <div class="signature">
      ${inv.signature_url ? `<img src="${inv.signature_url}" />` : '<div style="height:40px"></div>'}
      <p style="border-top:1px solid #333;padding-top:4px;font-size:11px">Authorized Signatory</p>
      <p style="font-size:10px;color:#888">${inv.company_name || ''}</p>
    </div>
  </div>
</body>
</html>`;
}

async function generateInvoicePdf(invoiceData) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    puppeteer = require('puppeteer-core');
  }

  const html = buildInvoiceHtml(invoiceData);

  const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };

  // Try to find Chrome on the system for puppeteer-core
  if (puppeteer.executablePath && typeof puppeteer.executablePath === 'function') {
    try {
      launchOptions.executablePath = puppeteer.executablePath();
    } catch {
      // On macOS, try common Chrome paths
      const { execSync } = require('child_process');
      try {
        const chromePath = execSync('which google-chrome-stable || which google-chrome || which chromium-browser || echo ""').toString().trim();
        if (chromePath) launchOptions.executablePath = chromePath;
      } catch {
        // Fallback to common macOS path
        const fs = require('fs');
        const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        if (fs.existsSync(macChrome)) launchOptions.executablePath = macChrome;
      }
    }
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

module.exports = { generateInvoicePdf, buildInvoiceHtml };
