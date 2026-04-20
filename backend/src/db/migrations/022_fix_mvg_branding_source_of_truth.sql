-- Fix legacy Microtechnique branding in MVG production data.
-- Long-term fix: correct company + template data at source (no render-time overrides).

WITH target_companies AS (
  SELECT id
  FROM companies
  WHERE is_deleted = FALSE
    AND (
      lower(coalesce(name, '')) LIKE '%microtechnique%'
      OR lower(coalesce(address, '')) LIKE '%microtechnique%'
      OR lower(coalesce(email, '')) LIKE '%microtechnique%'
      OR gstin = '07AASCM8531F1Z4'
      OR lower(coalesce(name, '')) LIKE '%mvg%'
    )
)
UPDATE companies c
SET
  name = 'MAVIDYA MVG PRADEEP GURU SYSTEM PRIVATE LIMITED',
  gstin = '07AASCM8531F1Z4',
  address = '1st Floor, 102, 52A, V81, Capital Tree, Jain Uniform Street, Nattu Sweets, Laxmi Nagar, Vijay Block, New Delhi - 110092',
  phone = '626006629',
  email = 'accounts@mavidya.com',
  updated_at = NOW()
WHERE c.id IN (SELECT id FROM target_companies);

WITH target_companies AS (
  SELECT id
  FROM companies
  WHERE is_deleted = FALSE
    AND (
      gstin = '07AASCM8531F1Z4'
      OR lower(coalesce(name, '')) LIKE '%mvg%'
    )
)
UPDATE invoice_templates it
SET
  layout_config =
    it.layout_config
    || jsonb_build_object('show_logo', true, 'logo_asset', 'mvg_group')
    || CASE
      WHEN it.template_key = 'trade'
        AND (
          coalesce(it.layout_config->>'bank_details', '') = ''
          OR lower(coalesce(it.layout_config->>'bank_details', '')) LIKE '%microtechnique%'
        )
      THEN jsonb_build_object(
        'show_bank_details', true,
        'bank_details',
        'MAVIDYA MVG PRADEEP GURU SYSTEM PVT.LTD.\n'
        || 'SBI A/C NO. 20529090825 | IFSC SBIN0007085 | Branch: Swasthya Vihar, New Delhi\n'
        || 'RBL A/C No. 409002393507 | IFSC RATN0000296 | Branch: Daryaganj, New Delhi'
      )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN it.template_key = 'trade'
        AND lower(coalesce(it.layout_config->>'terms_text', '')) LIKE '%microtechnique%'
      THEN jsonb_build_object(
        'show_terms', true,
        'terms_text',
        '1) All subject to Delhi jurisdiction only.\n'
        || '2) Goods sold will not be taken back.\n'
        || '3) Interest will be recovered @24% p.a. on bills not paid on due date.'
      )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN it.template_key = 'trade'
      THEN jsonb_build_object(
        'original_copy_label', 'ORIGINAL FOR RECIPIENT',
        'computer_gen_subnote', 'E. & O. E.'
      )
      ELSE '{}'::jsonb
    END,
  updated_at = NOW()
WHERE it.company_id IN (SELECT id FROM target_companies)
  AND it.is_deleted = FALSE;
