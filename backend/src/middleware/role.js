const ROLE_HIERARCHY = {
  super_admin: 4,
  company_admin: 3,
  branch_manager: 2,
  staff: 1,
  ca: 0, // CA is a lateral role — use requireRole() for explicit access
};

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

/**
 * Hierarchy-based check. CA role is excluded from the hierarchy
 * so they must be granted access via requireRole() explicitly.
 */
function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;

    // CA is a lateral role — never passes hierarchy checks
    if (userRole === 'ca') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = { requireRole, requireMinRole, ROLE_HIERARCHY };
