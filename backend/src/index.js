require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool } = require('./config/db');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// --------------- Middleware ---------------
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy for rate-limiter IP detection behind Nginx
app.set('trust proxy', 1);

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// --------------- Rate Limiters ---------------
// No custom keyGenerator — express-rate-limit v7+ defaults are IPv6-safe with app.set('trust proxy', …).
// A custom (req) => req.ip triggers ERR_ERL_KEY_GEN_IPV6 validation even when “fixed” on some builds.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Slow down.' },
});

// --------------- Health Check ---------------
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
  }
});

// --------------- API Routes ---------------
app.use('/api', apiLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/quotations', require('./routes/quotations'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/import', require('./routes/import'));
app.use('/api/invoice-templates', require('./routes/invoiceTemplates'));
app.use('/api/public', require('./routes/publicQuotations'));
app.use('/api/share', require('./routes/share'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/employees', require('./routes/employees'));

// --------------- 404 Handler ---------------
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// --------------- Global Error Handler ---------------
app.use(errorHandler);

// --------------- Background Jobs ---------------
const { schedulePenaltyJob } = require('./jobs/penaltyJob');
schedulePenaltyJob().catch((err) => console.error('Failed to schedule penalty job:', err.message));

const { scheduleReminderJobs } = require('./jobs/reminderJob');
scheduleReminderJobs().catch((err) => console.error('Failed to schedule reminder jobs:', err.message));

const { scheduleQuotationExpiryJob } = require('./jobs/quotationExpiryJob');
scheduleQuotationExpiryJob().catch((err) => console.error('Failed to schedule quotation expiry job:', err.message));

const { scheduleLoanReminderJob } = require('./jobs/loanReminderJob');
scheduleLoanReminderJob().catch((err) => console.error('Failed to schedule loan reminder job:', err.message));

// --------------- Start Server ---------------
const PORT = Number(process.env.PORT) || 4000;
// Bind all interfaces so other containers (e.g. nginx) can reach the API — required for Docker.
const HOST = process.env.LISTEN_HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Vehicle ERP API listening on http://${HOST}:${PORT}`);
  require('./worker.js');
});

module.exports = app;
