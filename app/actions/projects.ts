'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { record } from '@/lib/db/queries/feed';
import {
  listClients,
  listPackages,
  listPlatforms,
  type ClientRow,
  type PackageRow,
  type PlatformRow,
} from '@/lib/db/queries/catalogue';
import {
  addProjectMember,
  createProject,
  getProject,
  removeProjectMember,
  setPlatformLinks,
  setProjectPlatforms,
  updateProject,
} from '@/lib/db/queries/projects';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_REQUIRES_REASON,
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/domain/constants';
import { cadenceProblem, contractTargets, type Cadence } from '@/lib/domain/cadence';
import { can } from '@/lib/domain/permissions';
import { isoDateIn } from '@/lib/now';
import { generateForProject } from '@/lib/schedule/run';

/* ============================================================================
 * PROJECT ACTIONS — LAYER 3
 * ----------------------------------------------------------------------------
 * ── THE CODE IS DERIVED, NEVER SUBMITTED ─────────────────────────────────────
 * `code` decides the reference prefix, and the prefix is what makes `EVT-142`
 * self-describing (FR-113, Q-026). If a form could send it, a Client project
 * could be created with the code `EVT` and every task raised in it would lie
 * about what kind of work it is — permanently, because references are never
 * rewritten. So it comes from PROJECT_TYPE_META and the form cannot influence it.
 *
 * ── TYPE-SPECIFIC FIELDS ─────────────────────────────────────────────────────
 * Doc 15 §3 gives each type its own handful of fields. They are collected into
 * `type_fields` jsonb rather than forty mostly-null columns, because exactly one
 * shape is relevant to any given row. Only the keys the type declares are read,
 * so a hand-crafted POST cannot stuff arbitrary data into the column.
 * ========================================================================= */

export interface ProjectActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly projectId?: string;
}

const fail = (error: string): ProjectActionResult => ({ ok: false, error });

/** Doc 15 §3 — the only keys each type may carry. An allowlist, not a filter.
 *
 *  ⚠️ THIS MUST BE KEPT IN STEP WITH `TYPE_FIELD_FORMS` IN
 *  components/project/project-dialog.tsx. It is the server's list and it wins:
 *  a field added to the form and not to this one renders, accepts input, and is
 *  then **silently dropped on save** — which is exactly what happened when
 *  `expected_attendance` was added in CHANGE-PLAN 3.2 and the project came back
 *  without it.
 *
 *  The duplication is deliberate rather than lazy. The form's list carries
 *  labels, hints, input types and option lists — presentation the server has no
 *  business importing — and this one is a security boundary that must not be
 *  derived from anything a client component can change. Two lists, one rule:
 *  add to both, in the same commit. */
/* ── ⚠️ NINE KEYS REMOVED, 2026-08-19 ────────────────────────────────────────
   Owner: *"some are very extra things you have added in a project page."* Audited
   in docs/PROJECTS-REDESIGN.md §6 and removed here, with the reason each earned
   nothing:

     priority_tier             free text, placeholder "A". Nothing read it.
     expected_scale            asked of every type, used by no report.
     retainer_hours_per_month  an hours retainer they do not sell — the packages
                               sell DELIVERABLES, now real columns.
     internal_sponsor          duplicated owner_id, a real FK.
     engagement_type           superseded by `package_id`.
     campaign_goal/objective/  three prose boxes for "why are we doing this".
       area                    `description` covers it.
     channel                   ⚠️ the harmful one: the platform list written as a
                               SENTENCE, which is why nothing could be counted.
                               Replaced by `project_platforms` rows.

   Existing values stay in the jsonb harmlessly — this list controls what is
   WRITTEN, and the form has stopped asking. A later migration clears them.

   ⚠️ STILL MUST MATCH `TYPE_FIELD_FORMS` in project-dialog.tsx. A field in the
   form and not here renders, accepts input and is silently dropped on save. */
const TYPE_FIELDS: Readonly<Record<ProjectType, readonly string[]>> = {
  /* `duration` is a form control rather than a field, but it is stored: it is
     the only record of whether a one-day event was MEANT to be one day, as
     opposed to one whose end date has not been filled in yet. */
  event: ['venue', 'expected_attendance', 'duration'],
  client: [
    'client_name',
    'contact_person',
    'contact_email',
    'contact_phone',
    'contract_end',
    'is_billable',
  ],
  business: ['target_completion'],
  self_promotion: ['target_publish_date'],
  other: ['requested_by'],
};

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/* ── THE COMMERCIAL SHAPE — migration 033 ────────────────────────────────────
   Package, client, agreed fee and the agreed targets.

   ⚠️ EVERY TARGET IS READ AS "null OR A NUMBER", never as `Number(x) || null`.
   `Number('') === 0` and `0 || null === null`, so the reflexive version turns a
   deliberate zero into "no target" and an empty box into zero depending on which
   way you write it. Both are wrong: null means "nothing was agreed" and 0 means
   "agreed to publish nothing", and a report has to be able to tell them apart.

   ⚠️ These are the AGREED numbers, snapshotted. The form seeds them from the
   package; from then on they belong to the project. Editing SPARK next year must
   not rewrite what this client was promised. See migration 033's header. */
function intOrNull(form: FormData, key: string): number | null {
  const raw = str(form, key);
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * The weekdays ticked under one field name, as ISO numbers.
 *
 * ⚠️ Filtered against 1–7 rather than trusted. These arrive from a form and end up
 * in a `smallint[]` guarded by `app.weekdays_ok`, so a stray value would surface as
 * a constraint violation the reader cannot interpret. Deduplicated for the same
 * reason: the constraint refuses repeats, because two reels on one date is not what
 * "two reels a week" means.
 */
function weekdaysFrom(form: FormData, key: string): number[] {
  const seen = new Set<number>();
  for (const raw of form.getAll(key)) {
    const value = Number(String(raw));
    if (Number.isInteger(value) && value >= 1 && value <= 7) seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

/* ── ⚠️ THE CADENCE IS ENTERED; THE MONTHLY TARGETS ARE COMPUTED ──────────────
   Owner decision 2026-08-19: a rhythm is agreed — "one static post a day, two reels
   a week on Monday and Wednesday, Sundays off" — and the monthly figures follow.

   So the form no longer posts `assetsTargetMin` / `assetsTargetMax` /
   `reelsTargetMin` at all. They are derived here by `contractTargets()` and stored,
   which keeps every existing report reading exactly the column it already reads
   while leaving one place for a human to edit.

   Computed at write time rather than on read, deliberately: the monthly total
   depends on the length of the month as well as the rhythm, and a *contract* figure
   that shifted with the calendar would mean a client was promised less in February.
   Migration 036's header carries the full reasoning. */
function commercialFrom(form: FormData) {
  const kind = str(form, 'clientKind');

  const cadence: Cadence = {
    staticPostsPerDay: intOrNull(form, 'staticPostsPerDay'),
    reelsPerWeek: intOrNull(form, 'reelsPerWeek'),
    reelDays: weekdaysFrom(form, 'reelDays') as Cadence['reelDays'],
    postingDays: weekdaysFrom(form, 'postingDays') as Cadence['postingDays'],
  };

  const targets = contractTargets(cadence);

  return {
    clientKind: kind === 'internal' || kind === 'external' ? kind : null,
    clientId: str(form, 'clientId') || null,
    packageId: str(form, 'packageId') || null,
    monthlyFeePkr: intOrNull(form, 'monthlyFeePkr'),

    staticPostsPerDay: cadence.staticPostsPerDay,
    reelsPerWeek: cadence.reelsPerWeek,
    reelDays: cadence.reelDays,
    postingDays: cadence.postingDays,

    assetsTargetMin: targets.assetsMin,
    assetsTargetMax: targets.assetsMax,
    reelsTargetMin: targets.reelsMin,

    /* `renews_on` is no longer asked for — owner, 2026-08-19: *"Remove this field.
       We don't need it."* The column stays (dropping it would need a migration for
       no gain) and is simply never written from the form again. */
  } as const;
}

/** The same rules the form shows and migration 036 enforces. Checked here because a
 *  server action is reachable without the form. */
function cadenceRefusal(form: FormData): string | null {
  return cadenceProblem({
    staticPostsPerDay: intOrNull(form, 'staticPostsPerDay'),
    reelsPerWeek: intOrNull(form, 'reelsPerWeek'),
    reelDays: weekdaysFrom(form, 'reelDays') as Cadence['reelDays'],
    postingDays: weekdaysFrom(form, 'postingDays') as Cadence['postingDays'],
  });
}

/* ── What the form asks for per type, and must therefore receive ──────────────
   Owner, 2026-08-19: *"Every field should be compulsory."*

   ⚠️ MUST MATCH `TYPE_FIELD_FORMS` in project-dialog.tsx. A key here that the form
   does not render makes the form permanently unsubmittable — which is exactly what
   happened when this was first written against `TYPE_FIELDS` instead, whose
   `is_billable` and `duration` have no text input.

   The labels are duplicated from the form on purpose: the message a person reads
   after a refusal has to name the box they are looking at, and importing a client
   component's constant into a server action is not possible. */
const REQUIRED_TYPE_FIELDS: Readonly<
  Record<ProjectType, ReadonlyArray<readonly [string, string]>>
> = {
  event: [
    ['venue', 'Venue'],
    ['expected_attendance', 'Expected attendance'],
  ],
  client: [
    ['client_name', 'Client name'],
    ['contract_end', 'Contract end'],
    ['contact_person', 'Contact person'],
    ['contact_email', 'Contact email'],
    ['contact_phone', 'Contact phone'],
  ],
  business: [['target_completion', 'Target completion']],
  self_promotion: [['target_publish_date', 'Target publish date']],
  other: [['requested_by', 'Who asked for this']],
};

function collectTypeFields(form: FormData, type: ProjectType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TYPE_FIELDS[type]) {
    const value = str(form, key);
    if (value !== '') out[key] = value;
  }
  return out;
}

/**
 * The catalogue the project form needs: packages, platforms, clients.
 *
 * ── ⚠️ FETCHED BY THE FORM, NOT PASSED DOWN THROUGH PROPS ────────────────────
 * The obvious wiring is to load it in the Projects page and thread it into the
 * dialog. That breaks down because `AppShell` also opens this dialog — the global
 * "new project" action — so the data would have to be fetched in the LAYOUT and
 * every page in the application would pay for a catalogue only one dialog reads.
 *
 * It is small (eight packages, eleven platforms, a handful of clients) and only
 * wanted when the form opens, so the form asks for it then.
 */
export async function projectCatalogueAction(): Promise<{
  packages: PackageRow[];
  platforms: PlatformRow[];
  clients: ClientRow[];
}> {
  const user = await requireUser();
  const [packages, platforms, clients] = await Promise.all([
    listPackages(user.id),
    listPlatforms(user.id),
    listClients(user.id),
  ]);
  return { packages, platforms, clients };
}

/* ============================================================================
 * WHO IS ACCOUNTABLE — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"who is managing this project, who is responsible for any blunder, who is
 * responsible for delaying the project."*
 *
 * ── ⚠️ NAMING SOMEBODY ALSO GRANTS THEM SIGHT OF THE PROJECT ─────────────────
 * `app.project_is_visible` consults `project_members` (migration 033), so this is
 * not merely a label — it is an access grant. That is the point: before it,
 * somebody assigned to a project with no task on it could not see the project
 * they were accountable for. It also means removing a member REMOVES access, so
 * both directions are audited.
 * ========================================================================= */

const PROJECT_ROLES = [
  'manager',
  'content',
  'design',
  'development',
  'ads',
  'video',
  'other',
] as const;

export async function addProjectMemberAction(
  projectId: string,
  userId: string,
  role: string,
): Promise<ProjectActionResult> {
  const user = await requireUser();

  /* Coordinator+ — the same floor as `projects_update` and the RLS policy on
     `project_members`. The database refuses it either way; this exists so the
     answer is a sentence rather than a caught exception. */
  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return fail('Only a Team Coordinator or above can change who is on a project.');
  }
  if (!projectId || !userId) return fail('Choose somebody to add.');

  /* Validated against the list rather than cast: the value comes from a form and
     Postgres would refuse an unknown enum member as `22P02`, which is not a
     sentence anybody can act on. */
  const chosen = (PROJECT_ROLES as readonly string[]).includes(role) ? role : 'other';

  const project = await getProject(user.id, projectId);
  if (!project) return fail('That project is not available.');

  try {
    await addProjectMember(user.id, { projectId, userId, role: chosen });
  } catch {
    return fail('That person could not be added.');
  }

  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'project',
      entityId: projectId,
      action: 'member_added',
      summary: `added somebody to ${project.name}`,
      after: { userId, role: chosen },
    }),
  ).catch(() => console.error('[projects] member add was not recorded in the activity log'));

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { ok: true, projectId };
}

export async function removeProjectMemberAction(
  projectId: string,
  userId: string,
): Promise<ProjectActionResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return fail('Only a Team Coordinator or above can change who is on a project.');
  }

  const project = await getProject(user.id, projectId);
  if (!project) return fail('That project is not available.');

  const removed = await removeProjectMember(user.id, projectId, userId);
  if (!removed) return fail('They were not on this project.');

  await withUser(user.id, (tx) =>
    record(tx, user.id, {
      entityType: 'project',
      entityId: projectId,
      action: 'member_removed',
      summary: `removed somebody from ${project.name}`,
      /* ⚠️ Recorded because this REVOKES access as well as accountability — see
         the note above. A silent removal would take away someone's sight of a
         project with no trace of who did it. */
      before: { userId },
    }),
  ).catch(() => console.error('[projects] member removal was not recorded'));

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { ok: true, projectId };
}

export async function createProjectAction(
  _prev: ProjectActionResult,
  form: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.create')) {
    return fail('Only an Admin can create a project (doc 03 §3.2).');
  }

  const name = str(form, 'name');
  const type = str(form, 'type') as ProjectType;
  const status = (str(form, 'status') || 'active') as ProjectStatus;
  const statusReason = str(form, 'statusReason');

  if (!name) return fail('Give the project a name.');
  if (!PROJECT_TYPES.includes(type)) return fail('Choose a project type.');
  if (!PROJECT_STATUSES.includes(status)) return fail('That is not a valid status.');

  if (PROJECT_STATUS_REQUIRES_REASON.includes(status) && !statusReason) {
    return fail('Putting a project on hold or cancelling it requires a written reason.');
  }

  /* ── ⚠️ WHAT IS COMPULSORY, AND WHY THE END IS NOT ─────────────────────────
     Owner, 2026-08-19: *"the optional end date and time should be optional… Every
     field should be compulsory. Make it compulsory. Otherwise Create New Project
     will not be according to our requirement. We should put proper checks and
     proper validations on the form."*

     Checked HERE and not only in the form: a server action is a public endpoint
     reachable without the browser, so a `required` attribute is a courtesy to the
     person typing, never a guarantee about what arrives.

     The end date and time stay genuinely optional because a retainer has no end —
     that is what `is_permanent` is for — and demanding one would force somebody to
     invent a date the client never agreed to. */
  const required: ReadonlyArray<readonly [string, string]> = [
    ['startDate', 'Give the project a start date.'],
    ['startTime', 'Give the project a start time.'],
    ['clientKind', 'Say whether this is internal or for an external client.'],
    ['description', 'Write one line describing what this project is for.'],
  ];
  for (const [key, message] of required) {
    if (!str(form, key)) return fail(message);
  }

  /* The rhythm is the commitment now, so a project without one has agreed to
     nothing — which the monthly report would show as untargeted for ever. */
  if (!str(form, 'staticPostsPerDay') && !str(form, 'reelsPerWeek')) {
    return fail('Set the posting rhythm — static posts a day, reels a week, or both.');
  }
  if (form.getAll('postingDays').length === 0) {
    return fail('Pick at least one day of the week the project posts on.');
  }

  const cadenceError = cadenceRefusal(form);
  if (cadenceError) return fail(cadenceError);

  /* The type's own questions are compulsory too — they are what the type exists to
     ask, and a Client project with no client name is the shape being complained
     about.

     ⚠️ NOT `TYPE_FIELDS[type]`, which is the list of what may be STORED. That
     includes `is_billable` and `duration`, neither of which the form renders as a
     text field — requiring them would make the form impossible to submit. This list
     is deliberately the narrower "what the form asks for". */
  for (const [key, label] of REQUIRED_TYPE_FIELDS[type]) {
    if (!str(form, key)) {
      return fail(`${label} is required for a ${PROJECT_TYPE_META[type].label} project.`);
    }
  }

  try {
    const projectId = await createProject(user.id, {
      name,
      type,
      // Derived. See the header — a submitted code would make references lie.
      code: PROJECT_TYPE_META[type].code,
      description: str(form, 'description') || null,
      status,
      statusReason: statusReason || null,
      ownerId: str(form, 'ownerId') || user.id,
      startDate: str(form, 'startDate') || null,
      startTime: str(form, 'startTime') || null,
      targetEndDate: str(form, 'targetEndDate') || null,
      targetEndTime: str(form, 'targetEndTime') || null,
      typeFields: collectTypeFields(form, type),
      ...commercialFrom(form),
    });

    /* Platforms after the insert, because they need the project's id. Failing
       here would leave a project with no platforms rather than no project, which
       is the better of the two — the platforms are editable, a lost project is
       retyped. */
    const platformIds = form.getAll('platformIds').map(String).filter(Boolean);
    if (platformIds.length > 0) {
      await setProjectPlatforms(user.id, projectId, platformIds).catch(() =>
        console.error('[projects] the project was created but its platforms were not'),
      );
    }

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'project',
        entityId: projectId,
        action: 'created',
        summary: `created the project ${name}`,
        after: { name, type, status },
      }),
    );

    /* ── ⚠️ THE DAILY POSTS ARE CREATED WITH THE PROJECT ─────────────────────
       Owner, 2026-08-22: *"by default for every project create a daily task. I
       don't want anybody to add it for the first time. At the time of project
       creation please note it. I will not repeat this same thing again and
       again… The daily tasks will be created on the basis of a package: how many
       posts will be done every day and how many reels will be done every week."*

       So a project with an agreed rhythm arrives with the rest of its month
       already on the board. Nobody has to know a Generate button exists, which
       was the flaw in doing this only on demand — a project could sit for a week
       looking empty because the one person who knew about the button was away.

       ── WHY A FAILURE HERE DOES NOT FAIL THE PROJECT ────────────────────────
       The project IS created by this point and its row is committed. If the
       generator throws — an incoherent rhythm, a database blip — the honest
       outcome is a project with no tasks yet, not a "creation failed" message
       for something that plainly succeeded. The Generate schedule button on the
       Overview tab remains, and it is now the retry.

       A project with no rhythm (a website build, a one-off) generates nothing
       and is not an error; `generateForProject` reports that as a skip. */
    try {
      const from = isoDateIn();
      const pad = (n: number) => String(n).padStart(2, '0');
      const [fy, fm] = from.split('-').map(Number);
      const last = new Date(Date.UTC(fy, fm, 0));
      const to = `${fy}-${pad(fm)}-${pad(last.getUTCDate())}`;

      await generateForProject(user.id, projectId, from, to);
    } catch {
      /* Deliberately swallowed — see above. */
    }

    revalidatePath('/projects');
    revalidatePath('/dashboard');
    return { ok: true, projectId };
  } catch (error) {
    return fail(readable(error));
  }
}

/**
 * Record the client's page URL and handle for each platform — migration 037.
 *
 * ── ⚠️ THREE PARALLEL ARRAYS, ALIGNED BY INDEX ────────────────────────────────
 * The form posts `platformIds`, `pageUrls` and `handles` once per row, so the three
 * `getAll` results line up positionally. That is deliberate rather than naming each
 * field after its platform slug: a slug in a field name has to be parsed back out
 * here, and it breaks the moment two platforms share a prefix.
 *
 * The length check is not paranoia — a malformed post would otherwise pair a URL with
 * the wrong platform and quietly file a client's Instagram under Facebook.
 */
export async function savePlatformLinksAction(
  _prev: { ok: boolean; error?: string },
  form: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only an Admin can change a project.' };
  }

  const projectId = str(form, 'projectId');
  const existing = await getProject(user.id, projectId);
  if (!existing) return { ok: false, error: 'That project is no longer available.' };

  const ids = form.getAll('platformIds').map(String);
  const urls = form.getAll('pageUrls').map(String);
  const handles = form.getAll('handles').map(String);

  if (ids.length !== urls.length || ids.length !== handles.length) {
    return { ok: false, error: 'That form did not arrive intact. Reload and try again.' };
  }

  /* ⚠️ Only platforms the project actually manages. Without this filter a crafted
     post could attach a page to a platform the project does not use, and the row
     would then be invisible on every screen — the header only draws what the project
     has. */
  const managed = new Set(existing.platforms.map((platform) => platform.id));

  const links = ids
    .map((platformId, index) => ({
      platformId,
      /* Empty becomes NULL: the database refuses a blank handle and a blank URL would
         fail the URL check, so "clear this" cannot be ''. */
      pageUrl: urls[index]?.trim() || null,
      handle: handles[index]?.trim() || null,
    }))
    .filter((link) => managed.has(link.platformId));

  /* Checked here as well as by the constraint, so the reader gets a sentence naming
     the platform rather than an opaque check violation. */
  for (const link of links) {
    if (link.pageUrl !== null && !/^https?:\/\/\S+$/.test(link.pageUrl)) {
      const name = existing.platforms.find((p) => p.id === link.platformId)?.name ?? 'A platform';
      return { ok: false, error: `${name}: that is not a URL. It has to start with https://` };
    }
  }

  try {
    await setPlatformLinks(user.id, projectId, links);
  } catch {
    return { ok: false, error: 'Those links could not be saved.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function updateProjectAction(
  _prev: ProjectActionResult,
  form: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const projectId = str(form, 'projectId');

  const existing = await getProject(user.id, projectId);
  if (!existing) return fail('That project is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return fail('Only an Admin can edit a project (doc 03 §3.2).');
  }

  const status = (str(form, 'status') || existing.status) as ProjectStatus;
  const statusReason = str(form, 'statusReason');

  if (PROJECT_STATUS_REQUIRES_REASON.includes(status) && !statusReason && !existing.statusReason) {
    return fail(`Moving a project to ${status.replace('_', ' ')} requires a written reason.`);
  }

  /* Q-024: the catch-all project has to keep existing. If it could be archived,
     ad-hoc work would have nowhere to land and would go back to being invisible,
     which is the problem doc 15 exists to solve. */
  if (existing.isPermanent && (status === 'archived' || status === 'cancelled')) {
    return fail(
      'The Misc / Ad-hoc project cannot be archived — ad-hoc work has to have somewhere to land (Q-024).',
    );
  }

  /* The same rhythm rules as on create. An edit that broke the cadence would
     otherwise surface as a raw constraint violation from migration 036. */
  const cadenceError = cadenceRefusal(form);
  if (cadenceError) return fail(cadenceError);

  try {
    await updateProject(user.id, projectId, {
      name: str(form, 'name') || existing.name,
      description: str(form, 'description') || null,
      status,
      statusReason: statusReason || existing.statusReason,
      ownerId: str(form, 'ownerId') || existing.ownerId,
      startDate: str(form, 'startDate') || null,
      startTime: str(form, 'startTime') || null,
      targetEndDate: str(form, 'targetEndDate') || null,
      targetEndTime: str(form, 'targetEndTime') || null,
      typeFields: { ...existing.typeFields, ...collectTypeFields(form, existing.type) },
      ...commercialFrom(form),
    });

    /* ⚠️ Only touched when the form actually submitted the field. An edit form
       that does not include the platform ticks — a status change from elsewhere,
       say — must not be read as "no platforms", which would silently wipe the
       set and every per-platform target with it. `has` on the FormData is the
       difference between "none chosen" and "not asked". */
    if (form.has('platformsSubmitted')) {
      await setProjectPlatforms(
        user.id,
        projectId,
        form.getAll('platformIds').map(String).filter(Boolean),
      ).catch(() => console.error('[projects] platforms were not updated'));
    }

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'project',
        entityId: projectId,
        action: status === existing.status ? 'updated' : 'status_changed',
        summary:
          status === existing.status
            ? `updated the project ${existing.name}`
            : `moved ${existing.name} to ${status.replace('_', ' ')}`,
        before: { status: existing.status },
        after: { status, statusReason: statusReason || null },
      }),
    );

    revalidatePath('/projects');
    revalidatePath('/dashboard');
    return { ok: true, projectId };
  } catch (error) {
    return fail(readable(error));
  }
}

function readable(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('projects_reason_required')) {
    return 'That status needs a written reason.';
  }
  if (message.includes('projects_dates_ordered')) {
    return 'The target end date cannot be before the start date.';
  }
  if (message.includes('projects_single_permanent_idx')) {
    return 'There is already a permanent catch-all project (Q-024).';
  }
  if (message.includes('violates row-level security')) {
    return 'You do not have permission to change that.';
  }
  return 'That could not be saved. Nothing was changed.';
}
