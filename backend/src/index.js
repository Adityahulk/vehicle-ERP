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
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => req.ip,
});

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
app.use('/api/auth/login', loginLimiter);

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

// --------------- Start Server ---------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Vehicle ERP API running on port ${PORT}`);
});

module.exports = app;
