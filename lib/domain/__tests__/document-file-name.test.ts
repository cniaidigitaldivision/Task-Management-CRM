import { describe, expect, it } from 'vitest';

import { sendableFileName } from '../document-file-name';

describe('sendableFileName', () => {
  it('adds the extension a title does not have', () => {
    expect(sendableFileName('CRM Proposal', 'application/pdf')).toBe('CRM Proposal.pdf');
  });

  it('does not add it twice', () => {
    expect(sendableFileName('CRM Proposal.PDF', 'application/pdf')).toBe('CRM Proposal.PDF');
    expect(sendableFileName('site.jpeg', 'image/jpeg')).toBe('site.jpeg');
  });

  it('⚠️ gives a Word file its own extension, never ".pdf"', () => {
    expect(sendableFileName('Terms', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Terms.docx');
  });

  it('leaves a kind it does not know alone, and never sends a blank name', () => {
    expect(sendableFileName('Notes', 'application/x-unknown')).toBe('Notes');
    expect(sendableFileName('  ', 'application/pdf')).toBe('Document.pdf');
  });

  it('reads the mime type through its parameters', () => {
    expect(sendableFileName('Plan', 'application/pdf; charset=binary')).toBe('Plan.pdf');
  });
});
