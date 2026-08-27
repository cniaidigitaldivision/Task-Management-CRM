import * as React from 'react';

/* ============================================================================
 * RENDERING AN ANSWER
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"The response should not be like a paragraph. It should
 * be in a proper way, with a proper bold heading or something."*
 *
 * The prompt permits the model exactly three marks — `**bold**`, `## heading`
 * and `- bullet` — and this renders those three. Nothing else.
 *
 * ── ⚠️ WHY NOT A MARKDOWN LIBRARY ──────────────────────────────────────────
 * Two reasons, and the second is the one that matters.
 *
 * The first is proportion: this repo has twelve runtime dependencies and
 * `lib/ai/narrative.ts` already argued the case — *"a dependency, its
 * transitive tree and its release cadence is a poor trade"* — for a far larger
 * feature than three marks.
 *
 * The second is that a full markdown renderer accepts things the model was
 * never meant to send. Raw HTML, images, links, iframes. The answer text is
 * partly shaped by database content, which is partly shaped by whoever typed a
 * task title — so a renderer that will draw an `<img onerror=…>` is a rendering
 * of somebody's task title as markup. This parser can only ever emit a heading,
 * a list item, a bold span or a text node, so there is no path from a task
 * title to an element.
 *
 * ── ⚠️ UNKNOWN SYNTAX DEGRADES TO TEXT, NEVER TO NOTHING ───────────────────
 * A stray `|` table or a numbered list is shown as written rather than
 * swallowed. Losing a sentence because it was formatted unexpectedly is worse
 * than showing it plainly.
 *
 * A Server Component — pure string work, no state.
 * ========================================================================= */

/** `**bold**` inside one line. Everything else is text. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  /* Split on the delimiter itself so the captured groups alternate: even
     indices are plain text, odd indices are the bold content. */
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-text-primary">
        {part}
      </strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-t${index}`}>{part}</React.Fragment>
    ),
  );
}

export function AnswerText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];

  /* Consecutive `- ` lines are collected so they become ONE list. Emitting a
     separate <ul> per line would space them like paragraphs and lose the
     grouping a reader is scanning for. */
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
            <span className="min-w-0 flex-1">{inline(item, `li-${blocks.length}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^\s*-\s+/.test(line)) {
      bullets.push(line.replace(/^\s*-\s+/, ''));
      continue;
    }

    flushBullets();

    if (line.trim() === '') continue;

    /* `## Heading`, and `#` too — the model occasionally uses one hash for a
       heading despite being asked for two, and rendering that as literal text
       would put a stray `#` in front of a section title. */
    const heading = line.match(/^\s*#{1,3}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p
          key={`h-${blocks.length}`}
          className="mt-3 mb-1 text-caption font-semibold text-text-primary first:mt-0"
        >
          {inline(heading[1], `h-${blocks.length}`)}
        </p>,
      );
      continue;
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="my-1 first:mt-0 last:mb-0">
        {inline(line, `p-${blocks.length}`)}
      </p>,
    );
  }

  flushBullets();

  return <div className="text-caption leading-relaxed">{blocks}</div>;
}
