import { describe, expect, it } from 'vitest';

import { documentKindFromWords, productFromWords } from '../crm-product-words';

describe('productFromWords', () => {
  it('reads each product from a file name', () => {
    expect(productFromWords('CRM Purposal.pdf')).toBe('crm');
    expect(productFromWords('CRM_Quotation_Basic.pdf')).toBe('crm');
    expect(productFromWords('Taskly proposal 2026')).toBe('taskly');
    expect(productFromWords('ERP-inventory-brochure')).toBe('erp');
    expect(productFromWords('WhatsApp Automation pricing')).toBe('whatsapp');
    expect(productFromWords('Lead Management System')).toBe('crm');
  });

  it('⚠️ does not call every file with "WhatsApp" in it WhatsApp Automation', () => {
    expect(productFromWords('Share on WhatsApp')).toBeNull();
    expect(productFromWords('CRM with WhatsApp Business')).toBe('crm');
  });

  it('does not find "crm" inside another word', () => {
    expect(productFromWords('Acrmore profile')).toBeNull();
  });

  it('says nothing when it cannot tell', () => {
    expect(productFromWords('Company profile')).toBeNull();
    expect(productFromWords(null)).toBeNull();
  });
});

describe('documentKindFromWords', () => {
  it('reads the kind from a file name, misspellings included', () => {
    expect(documentKindFromWords('CRM Purposal')).toBe('brochure');
    expect(documentKindFromWords('Taskly Proposal')).toBe('brochure');
    expect(documentKindFromWords('CRM_Quotation_Premium')).toBe('quotation');
    expect(documentKindFromWords('ERP Price List')).toBe('price_list');
    expect(documentKindFromWords('Service agreement')).toBe('legal');
  });

  it('⚠️ a quotation that calls itself a proposal is a quotation', () => {
    expect(documentKindFromWords('Proposal and quotation for CRM')).toBe('quotation');
  });

  it('says nothing when it cannot tell', () => {
    expect(documentKindFromWords('scan0001')).toBeNull();
  });
});
