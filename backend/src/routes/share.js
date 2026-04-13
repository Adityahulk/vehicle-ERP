const { Router } = require('express');
const jwt = require('jsonwebtoken');
const ic = require('../controllers/invoicesController');
const { loadQuotationBundle, buildQuotationHtml } = require('../controllers/quotationsController');
const { generateInvoiceHtmlForPreview, generateInvoicePdf } = require('../services/pdfService');
const { htmlToPdfBuffer } = require('../services/htmlToPdf');
const { shareSecret } = require('../services/whatsappService');

const router = Router();

function htmlError(msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Link unavailable</title></head>
<body style="font-family:system-ui;padding:2rem;max-width:36rem;margin:auto">
<p>${msg}</p>
</body></html>`;
}

router.get('/invoice/:id', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(403).type('html').send(htmlError('Missing token.'));
    }
    let payload;
    try {
      payload = jwt.verify(token, shareSecret());
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(403).type('html').send(htmlError('This link has expired. Contact the dealer.'));
      }
      return res.status(403).type('html').send(htmlError('Invalid link.'));
    }
    if (payload.type !== 'invoice' || String(payload.id) !== String(req.params.id)) {
      return res.status(403).type('html').send(htmlError('Invalid link.'));
    }

    const companyId = payload.companyId;
    const data = await ic.fetchFullInvoice(req.params.id, companyId);
    if (!data) {
      return res.status(404).type('html').send(htmlError('Invoice not found.'));
    }

    const html = await generateInvoiceHtmlForPreview(data, companyId, undefined);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('share invoice:', err.message);
    res.status(500).type('html').send(htmlError('Unable to load invoice.'));
  }
});

router.get('/invoice/:id/pdf', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(403).send('Missing token.');
    let payload;
    try {
      payload = jwt.verify(token, shareSecret());
    } catch (e) {
      if (e.name === 'TokenExpiredError') return res.status(403).send('Expired.');
      return res.status(403).send('Invalid.');
    }
    if (payload.type !== 'invoice' || String(payload.id) !== String(req.params.id)) {
      return res.status(403).send('Invalid.');
    }
    const companyId = payload.companyId;
    const data = await ic.fetchFullInvoice(req.params.id, companyId);
    if (!data) return res.status(404).send('Not found.');
    const pdfBuf = await generateInvoicePdf(data, companyId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${data.invoice.invoice_number}.pdf"`);
    res.send(pdfBuf);
  } catch (err) {
    console.error('share invoice pdf:', err.message);
    res.status(500).send('Error');
  }
});

router.get('/quotation/:id', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(403).type('html').send(htmlError('Missing token.'));
    }
    let payload;
    try {
      payload = jwt.verify(token, shareSecret());
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(403).type('html').send(htmlError('This link has expired. Contact the dealer.'));
      }
      return res.status(403).type('html').send(htmlError('Invalid link.'));
    }
    if (payload.type !== 'quotation' || String(payload.id) !== String(req.params.id)) {
      return res.status(403).type('html').send(htmlError('Invalid link.'));
    }

    const companyId = payload.companyId;
    const bundle = await loadQuotationBundle(req.params.id, companyId);
    if (!bundle || bundle.quotation.is_deleted) {
      return res.status(404).type('html').send(htmlError('Quotation not found.'));
    }
    const html = buildQuotationHtml(bundle);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('share quotation:', err.message);
    res.status(500).type('html').send(htmlError('Unable to load quotation.'));
  }
});

router.get('/quotation/:id/pdf', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(403).send('Missing token.');
    let payload;
    try {
      payload = jwt.verify(token, shareSecret());
    } catch (e) {
      if (e.name === 'TokenExpiredError') return res.status(403).send('Expired.');
      return res.status(403).send('Invalid.');
    }
    if (payload.type !== 'quotation' || String(payload.id) !== String(req.params.id)) {
      return res.status(403).send('Invalid.');
    }
    const companyId = payload.companyId;
    const bundle = await loadQuotationBundle(req.params.id, companyId);
    if (!bundle || bundle.quotation.is_deleted) return res.status(404).send('Not found.');
    const html = buildQuotationHtml(bundle);
    const pdfBuf = await htmlToPdfBuffer(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${bundle.quotation.quotation_number}.pdf"`);
    res.send(pdfBuf);
  } catch (err) {
    console.error('share quotation pdf:', err.message);
    res.status(500).send('Error');
  }
});

module.exports = router;
