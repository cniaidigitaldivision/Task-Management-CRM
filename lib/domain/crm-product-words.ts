/* ============================================================================
 * WHICH PRODUCT, AND WHAT KIND OF DOCUMENT — read from a few words
 * ----------------------------------------------------------------------------
 * The business sells four separate products (Taskly, CRM, ERP, WhatsApp
 * Automation). A document filed under "All products" is offered to every lead,
 * so a CRM proposal left there would be sent to someone asking about Taskly.
 * That happened on 2026-09-21: "CRM Purposal" was on the shelf as Other / All
 * products, and the agent could not tell it was the CRM proposal.
 *
 * So the file name suggests both when a file is picked. It is a SUGGESTION —
 * the two selects still show it and a person can change it before uploading.
 *
 * ⚠️ THE SAME ORDER AS app.crm_product_from_words (231). ERP first ("inventory"
 * can appear in a CRM brochure's feature list, but a file named for ERP is ERP),
 * then Taskly, then CRM, and WhatsApp Automation last because "WhatsApp" alone
 * appears in every product's material.
 * ========================================================================= */

export type ProductWord = 'taskly' | 'crm' | 'erp' | 'whatsapp';

export function productFromWords(words: string | null | undefined): ProductWord | null {
  if (!words) return null;
  /* A file name joins words with _ - and . — "CRM_Proposal" must still say CRM. */
  const w = words.replace(/[_\-.]+/g, ' ');
  if (/\berp\b|inventory/i.test(w)) return 'erp';
  if (/taskly/i.test(w)) return 'taskly';
  if (/\bcrm\b|lead management/i.test(w)) return 'crm';
  if (/whats\s*app\s*(automation|api|business)/i.test(w)) return 'whatsapp';
  return null;
}

/** The knowledge page's kinds. Quotation before proposal: "Proposal quotation" is a quotation. */
export function documentKindFromWords(words: string | null | undefined): string | null {
  if (!words) return null;
  const w = words.replace(/[_\-.]+/g, ' ');
  if (/quot(e|ation)|\bestimate\b/i.test(w)) return 'quotation';
  if (/price\s*list|pricing|rate\s*list/i.test(w)) return 'price_list';
  if (/pr[ou]?pos[ae]l|purposal|brochure|profile|catalog(ue)?|deck/i.test(w)) return 'brochure';
  if (/terms|agreement|contract|legal|policy/i.test(w)) return 'legal';
  if (/letter\s*head/i.test(w)) return 'letterhead';
  return null;
}
