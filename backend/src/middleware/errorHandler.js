/**
 * Global error handler — catches all unhandled errors from route handlers.
 * Always returns a consistent JSON shape; never leaks stack traces in production.
 */
function errorHandler(err, req, res, _next) {
  const status = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Multer file size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large',
    });
  }

  // Zod / validation errors forwarded as-is
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.issues?.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry — a record with this value already exists',
    });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: 'Referenced record not found',
    });
  }

  console.error(`[ERROR] ${req.method} ${req.originalUrl}`, {
    status,
    message: err.message,
    ...(isProd ? {} : { stack: err.stack }),
    user_id: req.user?.id,
    company_id: req.user?.company_id,
    ip: req.ip,
  });

  res.status(status).json({
    success: false,
    error: isProd ? 'Internal server error' : err.message,
  });
}

module.exports = { errorHandler };
