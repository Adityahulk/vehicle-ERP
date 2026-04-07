const { query } = require('../config/db');

/**
 * Log an auditable action. Fire-and-forget — never blocks the response.
 */
function logAudit({ companyId, userId, action, entity, entityId, oldValue, newValue, req }) {
  const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
  const userAgent = req?.headers?.['user-agent'] || null;

  query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity, entity_id, old_value, new_value, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      companyId,
      userId || null,
      action,
      entity,
      entityId,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ip,
      userAgent,
    ],
  ).catch((err) => {
    console.error('[AuditLog] Failed to write audit log:', err.message);
  });
}

module.exports = { logAudit };
