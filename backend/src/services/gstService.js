// Indian state codes from GSTIN (first 2 digits)
const STATE_CODES = {
  '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UK', '06': 'HR',
  '07': 'DL', '08': 'RJ', '09': 'UP', '10': 'BR', '11': 'SK', '12': 'AR',
  '13': 'NL', '14': 'MN', '15': 'MZ', '16': 'TR', '17': 'ML', '18': 'AS',
  '19': 'WB', '20': 'JH', '21': 'OR', '22': 'CG', '23': 'MP', '24': 'GJ',
  '25': 'DD', '26': 'DN', '27': 'MH', '28': 'AP', '29': 'KA', '30': 'GA',
  '31': 'LD', '32': 'KL', '33': 'TN', '34': 'PY', '35': 'AN', '36': 'TS',
  '37': 'AP', '38': 'LD',
};

function getStateFromGstin(gstin) {
  if (!gstin || gstin.length < 2) return null;
  return gstin.substring(0, 2);
}

function isInterstate(companyGstin, customerGstin) {
  const companyState = getStateFromGstin(companyGstin);
  const customerState = getStateFromGstin(customerGstin);

  // If either GSTIN is missing, default to intrastate (same state)
  if (!companyState || !customerState) return false;

  return companyState !== customerState;
}

/**
 * Calculate GST for a line item.
 * @param {number} taxableAmount - amount in paise
 * @param {number} gstRate - total GST rate (e.g. 28 for 28%)
 * @param {boolean} interstate - true for IGST, false for CGST+SGST
 * @returns {{ cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount }}
 */
function calculateGst(taxableAmount, gstRate, interstate) {
  if (interstate) {
    const igstAmount = Math.round(taxableAmount * gstRate / 100);
    return {
      cgst_rate: 0,
      sgst_rate: 0,
      igst_rate: gstRate,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: igstAmount,
    };
  }

  const halfRate = gstRate / 2;
  const cgstAmount = Math.round(taxableAmount * halfRate / 100);
  const sgstAmount = Math.round(taxableAmount * halfRate / 100);
  return {
    cgst_rate: halfRate,
    sgst_rate: halfRate,
    igst_rate: 0,
    cgst_amount: cgstAmount,
    sgst_amount: sgstAmount,
    igst_amount: 0,
  };
}

// HSN codes and default GST rates for common vehicle sale items
const HSN_GST_MAP = {
  '8703': 28,   // Motor vehicles for transport of persons
  '8711': 28,   // Motorcycles
  '8704': 28,   // Motor vehicles for goods transport
  '9971': 18,   // Insurance services
  '9973': 18,   // Leasing / rental
  '8708': 28,   // Vehicle parts and accessories
  '9985': 18,   // Support services (RTO, documentation)
  'DEFAULT': 18,
};

function getGstRateForHsn(hsnCode) {
  return HSN_GST_MAP[hsnCode] || HSN_GST_MAP.DEFAULT;
}

module.exports = {
  STATE_CODES, getStateFromGstin, isInterstate,
  calculateGst, getGstRateForHsn, HSN_GST_MAP,
};
