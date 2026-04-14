/** Default invoice template layout (merged with DB layout_config). */
const DEFAULT_LAYOUT = {
  show_logo: true,
  show_signature: true,
  show_qr_code: false,
  show_bank_details: false,
  show_terms: true,
  terms_text: 'Goods once sold will not be taken back or exchanged. Subject to local jurisdiction.',
  primary_color: '#1a56db',
  font: 'default',
  header_style: 'left-aligned',
  show_vehicle_details_block: true,
  show_loan_summary: false,
  footer_text: '',
  bank_details: '',
  /** company_upload | mvg_group — same file as website /assets/mvg-logo.png, bundled for PDFs */
  logo_asset: 'company_upload',
  /** company_upload | rudra_proprietor | mavidya_director — preset PNGs in assets/invoice-signatures */
  signature_asset: 'company_upload',
  signatory_title: 'Authorised Signatory',
  original_copy_label: 'ORIGINAL FOR RECIPIENT',
  ship_to_same_as_billing: true,
  computer_gen_subnote: 'E. & O. E.',
};

module.exports = { DEFAULT_LAYOUT };
