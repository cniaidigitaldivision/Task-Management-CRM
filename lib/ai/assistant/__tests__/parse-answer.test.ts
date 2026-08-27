import { describe, expect, it } from 'vitest';

import { parseAnswer } from '@/lib/ai/assistant/run';

/* ============================================================================
 * READING WHAT THE MODEL SENT BACK
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHY THIS FILE EXISTS ────────────────────────────────────────────────
 * A screenshot, 2026-08-27. The assistant answered a comparison question with
 * clean prose and then printed forty lines of chart specification into the chat
 * as a paragraph:
 *
 *   Lareeb Khan — 38% utilised
 *   {"kind":"bars","title":"Weekly Utilisation for Each Team Member",...}
 *
 * The chart never drew. The whole reply was not valid JSON, `JSON.parse` threw,
 * and the tolerant fallback returned the content verbatim — which is the right
 * instinct (a prose answer should not be discarded) applied without asking what
 * the content actually was.
 *
 * ⚠️ NOTHING IN THE TEST SUITE COULD HAVE CAUGHT THIS, and that is the point of
 * writing these down. The model's output is not deterministic and is not
 * exercised by any test; the failure lived in a pure function that was never
 * called with a realistic malformed input. These cases are those inputs.
 * ========================================================================= */

const BARS =
  '{"kind":"bars","title":"Weekly Utilisation","question":"How busy is everyone?",' +
  '"format":"integer","bars":[{"label":"Lareeb Khan","value":38,"token":"accent-primary"},' +
  '{"label":"Kashif Ahmed","value":25,"token":"accent-primary"}]}';

describe('a well-formed reply', () => {
  it('returns the prose and the chart', () => {
    const result = parseAnswer(JSON.stringify({ answer: 'Lareeb is busiest.', chart: JSON.parse(BARS) }));
    expect(result.answer).toBe('Lareeb is busiest.');
    expect(result.chart?.kind).toBe('bars');
  });

  it('accepts a null chart', () => {
    const result = parseAnswer('{"answer":"Nothing is overdue.","chart":null}');
    expect(result.answer).toBe('Nothing is overdue.');
    expect(result.chart).toBeNull();
  });
});

describe('replies that are not quite JSON', () => {
  it('reads a reply wrapped in a ```json fence', () => {
    // ⚠️ Recovers the CHART too, not just the prose. The old parser threw both
    // away and rendered the fence markers into the chat.
    const result = parseAnswer('```json\n{"answer":"Lareeb is busiest.","chart":' + BARS + '}\n```');
    expect(result.answer).toBe('Lareeb is busiest.');
    expect(result.chart?.kind).toBe('bars');
  });

  it('reads a reply with a sentence in front of the object', () => {
    const result = parseAnswer('Here you go:\n{"answer":"Two are overdue.","chart":null}');
    expect(result.answer).toBe('Two are overdue.');
  });

  it('does not stop at the first closing brace', () => {
    // ⚠️ The chart is full of nested objects. A lazy match cuts the reply in
    // half and parses nothing, which is how "recover the JSON" quietly becomes
    // "lose the chart".
    const result = parseAnswer('```\n{"answer":"See below.","chart":' + BARS + '}\n```');
    expect(result.chart?.kind).toBe('bars');
    if (result.chart?.kind === 'bars') expect(result.chart.bars).toHaveLength(2);
  });
});

describe('the failure that reached a screen', () => {
  it('never prints a chart specification as prose', () => {
    // The exact shape observed: prose, then a bare spec, with no wrapper — so
    // the whole string is unparseable.
    const result = parseAnswer(`- **Lareeb Khan** — 38% utilised\n\n${BARS}`);

    expect(result.answer).toBe('- **Lareeb Khan** — 38% utilised');
    expect(result.answer).not.toContain('"kind"');
    expect(result.answer).not.toContain('accent-primary');
  });

  it('strips a spec the model put inside the answer STRING as well', () => {
    // ⚠️ A separate path from the one above: this reply parses fine, so the
    // fallback never runs. Both had to be fixed; only one was obvious.
    const result = parseAnswer(
      JSON.stringify({ answer: `Lareeb is busiest.\n\n${BARS}`, chart: JSON.parse(BARS) }),
    );

    expect(result.answer).toBe('Lareeb is busiest.');
    expect(result.chart?.kind).toBe('bars');
  });
});

describe('what must NOT be stripped', () => {
  it('leaves plain prose alone', () => {
    const result = parseAnswer('Nothing is overdue right now.');
    expect(result.answer).toBe('Nothing is overdue right now.');
    expect(result.chart).toBeNull();
  });

  it('keeps an answer that merely contains braces', () => {
    // ⚠️ The cut is anchored to `{"kind"` and must look like a spec, precisely
    // so that a project genuinely named with braces survives. An over-eager
    // strip is a silently truncated answer — worse than the bug it fixes,
    // because nobody can see what went missing.
    const text = 'The project **{Redesign}** is on track, and {"note":"nothing"} is fine.';
    expect(parseAnswer(text).answer).toBe(text);
  });

  it('does not treat a JSON array as a reply object', () => {
    const result = parseAnswer('[1, 2, 3]');
    expect(result.answer).toBe('[1, 2, 3]');
    expect(result.chart).toBeNull();
  });

  it('drops a malformed chart rather than rendering it', () => {
    // `validChart` already did this; asserted here so the new parsing path
    // cannot accidentally route around it.
    const result = parseAnswer('{"answer":"Fine.","chart":{"kind":"pie","slices":[]}}');
    expect(result.answer).toBe('Fine.');
    expect(result.chart).toBeNull();
  });
});
