/* ============================================================================
 * GIVE THE DEMO LEADS THE SOURCES THE DESIGN SHOWS
 * ----------------------------------------------------------------------------
 * Run: node scripts/seed-demo-sources.mjs
 *
 * Owner, 2026-09-15: *"In the last source column please add some dummy sources
 * like: Facebook, Instagram, LinkedIn, Google, Website, Referral."*
 *
 * Every demo lead was `manual` with no detail, so the column rendered "Added by
 * hand" on all 21 rows and told a reader nothing.
 *
 * ── ⚠️ THE DEMO PROJECT ONLY, AND THE GUARD IS NOT A COMMENT ───────────────
 * The owner's standing rule: *"Chitral Royal Homes or any other project is my
 * client. I can't use their data for testing purposes."* This script refuses to
 * run if it cannot find a project whose name ends `[demo]`, and every statement
 * is bounded by that project's id. A stray update here would rewrite the
 * attribution of real client enquiries — which is how a channel's
 * cost-per-lead silently becomes wrong.
 *
 * ── ⚠️ AND IT IS RE-RUNNABLE ───────────────────────────────────────────────
 * Assignment is by position, ordered by id, so running it twice produces the
 * same spread rather than reshuffling it. A demo whose data moves between
 * screenshots is one nobody can point at in a meeting.
 * ========================================================================= */
import fs from 'node:fs';
import postgres from 'postgres';

const raw = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(.*?))\s*$/);
  if (m) env[m[1]] = m[2] ?? m[3] ?? (m[4] || '').replace(/\s+#.*$/, '').trim();
}
const sql = postgres(env.DATABASE_URL, { prepare: false, ssl: 'require', connect_timeout: 20 });

/* The six the owner named, each with the sub-label that channel actually
   produces. ⚠️ `meta_lead_ad` and `import` are deliberately absent — both are
   written by machines, and filing a hand-entered lead under a campaign that
   never ran puts it in that campaign's reporting bucket. */
const SPREAD = [
  /* ⚠️ THE DETAIL SAYS WHAT KIND OF THING IT WAS, not where it was. Owner,
     2026-09-15: *"if leads are coming from Google, it should show that it is a
     Google ad."* "Google · Search ad" and "Google · Display ad" are two
     different spends with two different cost-per-leads; "Google · Google" is a
     line that tells a reader nothing they did not already see in the logo. */
  ['facebook', 'Lead ad'],
  ['instagram', 'Story ad'],
  ['google', 'Search ad'],
  ['website', 'Contact form'],
  ['referral', 'Existing client'],
  ['linkedin', 'Lead gen form'],
  ['facebook', 'Messenger ad'],
  ['instagram', 'Reels ad'],
  ['google', 'Display ad'],
  ['walk_in', 'Office visit'],
  ['whatsapp', 'Direct message'],
  ['website', 'Live chat'],
  ['referral', 'Partner agent'],
  /* ⚠️ `manual` STAYS IN THE SPREAD. Sarah typing a phone enquiry at her desk
     is a real channel and the desk has to show it honestly — a demo where every
     lead arrived from an ad hides the one row that tests the Add Lead path. */
  ['manual', 'Phone enquiry'],
];

try {
  const [project] = await sql`
    select id, name from public.projects where name like '%[demo]' limit 1`;

  if (!project) {
    console.error('✗ No project named "… [demo]". Refusing to touch anything else.');
    process.exit(1);
  }

  const leads = await sql`
    select id from public.crm_leads where project_id = ${project.id} order by id`;

  if (leads.length === 0) {
    console.log('No demo leads to update.');
    process.exit(0);
  }

  let n = 0;
  for (let i = 0; i < leads.length; i++) {
    const [source, detail] = SPREAD[i % SPREAD.length];
    await sql`
      update public.crm_leads
         set source = ${source}::public.crm_lead_source,
             source_detail = ${detail}
       where id = ${leads[i].id}
         /* ⚠️ Belt and braces: the id came from this project, and the WHERE says
            so again. One wrong variable here is a real client's lead. */
         and project_id = ${project.id}`;
    n += 1;
  }

  const spread = await sql`
    select source::text, source_detail, count(*)::int as n
      from public.crm_leads where project_id = ${project.id}
     group by 1, 2 order by n desc, 1`;

  console.log(`\n${project.name} — ${n} leads updated:\n`);
  for (const r of spread) {
    console.log(`  ${String(r.source).padEnd(12)} ${String(r.source_detail).padEnd(16)} ×${r.n}`);
  }

  const [outside] = await sql`
    select count(*)::int as n from public.crm_leads
     where project_id <> ${project.id} and source in ('facebook','instagram','google','website','referral','linkedin')`;
  console.log(`\n  leads outside the demo project carrying these sources: ${outside.n}`);
  console.log('  (should be 0 unless a real project genuinely uses them)\n');
} finally {
  await sql.end({ timeout: 5 });
}
