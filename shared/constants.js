const ROLES = {
  SUPER_ADMIN: 'super_admin',
  COMPANY_ADMIN: 'company_admin',
  BRANCH_MANAGER: 'branch_manager',
  STAFF: 'staff',
};

const VEHICLE_STATUS = {
  IN_STOCK: 'in_stock',
  SOLD: 'sold',
  TRANSFERRED: 'transferred',
  SCRAPPED: 'scrapped',
};

const INVOICE_STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
};

const LOAN_STATUS = {
  ACTIVE: 'active',
  CLOSED: 'closed',
  OVERDUE: 'overdue',
};

const QUOTATION_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
};

const GST_RATES = {
  INTRA_STATE: { cgst: 14, sgst: 14, igst: 0 },
  INTER_STATE: { cgst: 0, sgst: 0, igst: 28 },
};

module.exports = {
  ROLES,
  VEHICLE_STATUS,
  INVOICE_STATUS,
  LOAN_STATUS,
  QUOTATION_STATUS,
  GST_RATES,
};
