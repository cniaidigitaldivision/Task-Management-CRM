import { describe, expect, it } from 'vitest';

import { namedSummary } from '@/lib/view/task-name';

describe('namedSummary', () => {
  it('puts the task name where the log wrote its code', () => {
    expect(namedSummary('moved CLI-1621 to Done', 'CLI-1621', 'Etemaad100 post')).toBe(
      'moved Etemaad100 post to Done',
    );
  });

  it('replaces every occurrence, not just the first', () => {
    expect(namedSummary('created BIZ-118, then closed BIZ-118', 'BIZ-118', 'Monthly report')).toBe(
      'created Monthly report, then closed Monthly report',
    );
  });

  it('leaves a summary that never mentions the code alone', () => {
    expect(namedSummary('Uploaded artwork', 'CLI-1621', 'Carousel')).toBe('Uploaded artwork');
  });

  /* ⚠️ THE REASON IT IS A SPLIT AND NOT A REGEX. A reference built into a
     pattern would let `.` match any character, so a summary about a DIFFERENT
     task would be rewritten with this task's name. */
  it('does not treat the reference as a pattern', () => {
    expect(namedSummary('moved C.I-1 to Done', 'C.I-1', 'Real task')).toBe('moved Real task to Done');
    expect(namedSummary('moved CxI-1 to Done', 'C.I-1', 'Real task')).toBe('moved CxI-1 to Done');
  });

  it('is safe when there is no reference or no title', () => {
    expect(namedSummary('something happened', '', 'Title')).toBe('something happened');
    expect(namedSummary('moved CLI-1 to Done', 'CLI-1', '')).toBe('moved CLI-1 to Done');
  });
});
