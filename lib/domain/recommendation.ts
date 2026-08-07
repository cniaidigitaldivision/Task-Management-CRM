import {
  PERFORMANCE_HISTORY_MINIMUM_TASKS,
  PERFORMANCE_NEUTRAL_SCORE,
  RECOMMENDATION_USABILITY_FLOOR,
  SCORE_PENALTIES,
  SCORE_WEIGHTS,
  type ScoreWeights,
} from './constants';

/* ============================================================================
 * ASSIGNMENT RECOMMENDATIONS — doc 07, FR-050 to FR-057
 * ----------------------------------------------------------------------------
 * Six dimensions, weighted, minus penalties. Pure arithmetic over data handed
 * in — no database, no clock, no randomness — which is what lets the whole
 * thing be tested exhaustively against doc 07's own worked example.
 *
 * ── IT SUGGESTS. IT DOES NOT DECIDE ──────────────────────────────────────────
 * Nothing here assigns anybody. It produces a ranked list and, for each person,
 * the six numbers that produced their rank. A recommendation somebody cannot
 * interrogate is an oracle, and an oracle is either obeyed without thought or
 * ignored entirely. Both are worse than a number with a reason attached.
 *
 * ── AND WHEN NOBODY FITS IT STOPS RECOMMENDING PEOPLE (FR-054) ───────────────
 * Below the usability floor the honest answer is not "here is the least bad
 * person". It is "the shape of this task is wrong" — extend the deadline, split
 * it, rebalance, or override deliberately. Ranking five people who all score 20
 * dresses a problem up as a choice.
 *
 * ── PAST PERFORMANCE IS THE SMALLEST WEIGHT ON PURPOSE ───────────────────────
 * 5%. It nudges; it must never dominate, and it must never become a
 * surveillance tool. Somebody with fewer than five completed tasks gets a
 * neutral score rather than being punished for being new.
 * ========================================================================= */

export interface RequiredSkill {
  readonly skillId: string;
  readonly label: string;
  /** 1 nice to have · 2 needed · 3 essential. */
  readonly weight: number;
}

export interface CandidateSkill {
  readonly skillId: string;
  /** 1–5. */
  readonly proficiency: number;
}

export interface Candidate {
  readonly userId: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly skills: readonly CandidateSkill[];

  /** Weighted points already committed this week. */
  readonly currentLoadPoints: number;
  /** Points they can take this week, after leave. 0 when fully unavailable. */
  readonly effectiveCapacityPoints: number;
  readonly activeTaskCount: number;
  readonly maxConcurrentTasks: number;
  /** Committed points falling due on or before this task's due date. */
  readonly committedBeforeDuePoints: number;

  /** How many tasks they were given in the last 14 days. */
  readonly recentAssignments: number;

  /** Last 90 days. */
  readonly completedCount: number;
  readonly onTimeRate: number;
  readonly revisionRate: number;

  /** Open tasks they hold in this task's project. */
  readonly openTasksInProject: number;
  readonly hasWorkedOnProject: boolean;
}

export interface TaskProfile {
  readonly requiredSkills: readonly RequiredSkill[];
  /** The weighted cost of the task being assigned. */
  readonly loadPoints: number;
  /** Days from now until it is due; null when there is no date. */
  readonly daysToDue: number | null;
}

export interface TeamContext {
  /** Assignments made to everybody in the last 14 days. */
  readonly totalRecentAssignments: number;
  readonly teamSize: number;
  readonly softThresholdPct: number;
  readonly hardThresholdPct: number;
  readonly weights?: ScoreWeights;
}

export interface DimensionScores {
  readonly skill: number;
  readonly availability: number;
  readonly deadlineFit: number;
  readonly fairness: number;
  readonly performance: number;
  readonly projectFamiliarity: number;
}

export type RecommendationFlag =
  | 'stretch'
  | 'over_soft'
  | 'over_hard'
  | 'at_max_concurrent'
  | 'unavailable'
  | 'new_to_team';

export interface Recommendation {
  readonly userId: string;
  readonly name: string;
  readonly roleTitle: string | null;
  /** 0–100 after weighting and penalties. */
  readonly score: number;
  readonly dimensions: DimensionScores;
  readonly penaltyPoints: number;
  readonly projectedUtilisationPct: number;
  readonly flags: readonly RecommendationFlag[];
  /** One sentence naming the strongest reason for this rank. */
  readonly why: string;
}

const clamp = (value: number, low = 0, high = 100): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;

/**
 * One decimal place, applied wherever a dimension divides.
 *
 * Not cosmetic. (3 × 2/5 + 1 × 3/5) / 4 × 100 is 45.00000000000001 in binary
 * floating point, and an exported score that reads 45.00000000000001 is one
 * somebody will eventually put straight into a template. Rounding at the
 * boundary — where the arithmetic becomes a score — keeps every consumer
 * honest rather than making each one remember.
 */
const round = (value: number): number => Math.round(value * 10) / 10;

/* ==========================================================================
 * S1 · SKILL MATCH
 * ========================================================================== */

/**
 * doc 07 §3 S1: Σ(weight × proficiency/5) ÷ Σ(weight) × 100.
 *
 * A task with no required skills scores everybody 100 rather than 0. Zero would
 * make skill — the heaviest dimension — punish the whole team for a tagging
 * omission, and the ranking would then be decided almost entirely by
 * availability while appearing to be about skill.
 */
export function skillScore(
  required: readonly RequiredSkill[],
  held: readonly CandidateSkill[],
): number {
  if (required.length === 0) return 100;

  const byId = new Map(held.map((s) => [s.skillId, s.proficiency]));
  let weighted = 0;
  let totalWeight = 0;

  for (const skill of required) {
    const weight = Math.max(0, skill.weight);
    totalWeight += weight;
    const proficiency = byId.get(skill.skillId) ?? 0;
    weighted += weight * (clamp(proficiency, 0, 5) / 5);
  }

  if (totalWeight === 0) return 100;
  return round(clamp((weighted / totalWeight) * 100));
}

/* ==========================================================================
 * S2 · AVAILABILITY HEADROOM
 * ========================================================================== */

export function availabilityScore(projectedUtilisationPct: number): number {
  return clamp(100 - projectedUtilisationPct);
}

export function projectedUtilisation(candidate: Candidate, taskLoad: number): number {
  /* Zero capacity means on leave. Utilisation is undefined rather than
     infinite, and reporting 100% would make them merely "very busy" — the
     penalty and the flag are what say "not here this week". */
  if (candidate.effectiveCapacityPoints <= 0) return 100;
  return Math.round(
    ((candidate.currentLoadPoints + taskLoad) / candidate.effectiveCapacityPoints) * 100,
  );
}

/* ==========================================================================
 * S3 · DEADLINE FIT
 * ========================================================================== */

/**
 * doc 07 §3 S3. Someone at 45% overall with everything due Thursday is not a
 * good fit for a Wednesday deadline, and S2 alone cannot see that.
 *
 * With no due date the dimension has nothing to measure, so everybody gets 100
 * — the same reasoning as an untagged skill list. Scoring 0 would silently
 * penalise every undated task.
 */
export function deadlineFitScore(candidate: Candidate, task: TaskProfile): number {
  if (task.daysToDue === null) return 100;
  if (task.loadPoints <= 0) return 100;

  /* Already overdue, or due today. Whether anybody can absorb it is no longer
     a capacity question. */
  if (task.daysToDue <= 0) return 0;

  const free = candidate.effectiveCapacityPoints - candidate.committedBeforeDuePoints;
  if (free <= 0) return 0;

  return round(clamp((free / task.loadPoints) * 100));
}

/* ==========================================================================
 * S4 · FAIRNESS
 * ========================================================================== */

/**
 * doc 07 §3 S4 — an explicit anti-favouritism term, so the same reliable person
 * does not quietly absorb everything.
 *
 *   100 − (theirs / teamTotal × 100 × teamSize)
 *
 * An even distribution scores 100 for everybody: with 7 people each holding a
 * seventh of the assignments, theirs/total × teamSize is 1, and 100 − 100... is
 * 0, not 100. The document's formula, read literally, inverts. What it means —
 * and what §3's own table asserts — is that an even share is neutral-good and
 * an outsized share is penalised. So the ratio is taken against the FAIR share
 * rather than against the whole, which produces 100 for an even split and falls
 * away as somebody's share grows past it.
 */
export function fairnessScore(
  recentAssignments: number,
  totalRecentAssignments: number,
  teamSize: number,
): number {
  /* Nothing assigned to anybody recently: nobody is being favoured, so the
     dimension has no information and must not invent any. */
  if (totalRecentAssignments <= 0 || teamSize <= 0) return 100;

  const fairShare = totalRecentAssignments / teamSize;
  if (fairShare <= 0) return 100;

  const ratio = recentAssignments / fairShare;
  /* At or below a fair share → 100. At twice a fair share → 0. */
  return round(clamp(100 - Math.max(0, ratio - 1) * 100));
}

/* ==========================================================================
 * S5 · PAST PERFORMANCE
 * ========================================================================== */

export function performanceScore(candidate: Candidate): number {
  if (candidate.completedCount < PERFORMANCE_HISTORY_MINIMUM_TASKS) {
    return PERFORMANCE_NEUTRAL_SCORE;
  }
  const onTime = clamp(candidate.onTimeRate, 0, 1);
  const revisions = clamp(candidate.revisionRate, 0, 1);
  return round(clamp(onTime * 70 + (1 - revisions) * 30));
}

/* ==========================================================================
 * S6 · PROJECT FAMILIARITY
 * ========================================================================== */

export function familiarityScore(candidate: Candidate): number {
  return clamp(
    Math.min(100, candidate.openTasksInProject * 25 + (candidate.hasWorkedOnProject ? 30 : 0)),
  );
}

/* ==========================================================================
 * THE SCORE
 * ========================================================================== */

export function scoreCandidate(
  candidate: Candidate,
  task: TaskProfile,
  team: TeamContext,
): Recommendation {
  const weights = team.weights ?? SCORE_WEIGHTS;
  const utilisation = projectedUtilisation(candidate, task.loadPoints);

  const dimensions: DimensionScores = {
    skill: round(skillScore(task.requiredSkills, candidate.skills)),
    availability: round(availabilityScore(utilisation)),
    deadlineFit: round(deadlineFitScore(candidate, task)),
    fairness: round(
      fairnessScore(candidate.recentAssignments, team.totalRecentAssignments, team.teamSize),
    ),
    performance: round(performanceScore(candidate)),
    projectFamiliarity: round(familiarityScore(candidate)),
  };

  const weighted =
    dimensions.skill * weights.skill +
    dimensions.availability * weights.availability +
    dimensions.deadlineFit * weights.deadlineFit +
    dimensions.fairness * weights.fairness +
    dimensions.performance * weights.performance +
    dimensions.projectFamiliarity * weights.projectFamiliarity;

  /* ── Penalties, doc 07 §2 stage 3 ────────────────────────────────────────
     Applied AFTER weighting, not folded into a dimension. A penalty is a
     statement about the assignment as a whole — "this would put them over the
     line" — not a revision of how skilled they are. Keeping them separate is
     also what lets the panel show a score and its deductions rather than one
     number nobody can reconstruct. */
  const flags: RecommendationFlag[] = [];
  let penalty = 0;

  if (candidate.effectiveCapacityPoints <= 0) {
    flags.push('unavailable');
    penalty += SCORE_PENALTIES.overHardThreshold;
  } else {
    if (utilisation > team.hardThresholdPct) {
      flags.push('over_hard');
      penalty += SCORE_PENALTIES.overHardThreshold;
    } else if (utilisation > team.softThresholdPct) {
      flags.push('over_soft');
      penalty += SCORE_PENALTIES.overSoftThreshold;
    }
  }

  if (candidate.activeTaskCount >= candidate.maxConcurrentTasks) {
    flags.push('at_max_concurrent');
    penalty += SCORE_PENALTIES.atMaxConcurrent;
  }

  if (task.requiredSkills.length > 0 && dimensions.skill === 0) {
    flags.push('stretch');
    penalty += SCORE_PENALTIES.zeroSkillMatch;
  }

  if (candidate.completedCount < PERFORMANCE_HISTORY_MINIMUM_TASKS) {
    flags.push('new_to_team');
  }

  return {
    userId: candidate.userId,
    name: candidate.name,
    roleTitle: candidate.roleTitle,
    score: round(clamp(weighted + penalty)),
    dimensions,
    penaltyPoints: penalty,
    projectedUtilisationPct: utilisation,
    flags,
    why: explain(dimensions, flags, weights),
  };
}

/**
 * The one sentence under the name.
 *
 * Names the dimension contributing most to this person's position, and the
 * worst flag against them. "Strong skill match, but this would put them over
 * their limit" is a decision somebody can make; "Score 61" is not.
 */
function explain(
  dimensions: DimensionScores,
  flags: readonly RecommendationFlag[],
  weights: ScoreWeights,
): string {
  const contributions: Array<[keyof DimensionScores, number, string]> = [
    ['skill', dimensions.skill * weights.skill, 'the skills this needs'],
    ['availability', dimensions.availability * weights.availability, 'room in their week'],
    ['deadlineFit', dimensions.deadlineFit * weights.deadlineFit, 'time before the due date'],
    ['fairness', dimensions.fairness * weights.fairness, 'a lighter recent share of new work'],
    ['performance', dimensions.performance * weights.performance, 'a strong recent record'],
    [
      'projectFamiliarity',
      dimensions.projectFamiliarity * weights.projectFamiliarity,
      'already being in this project',
    ],
  ];

  const strongest = contributions.reduce((best, current) =>
    current[1] > best[1] ? current : best,
  );

  const caveat =
    flags.includes('unavailable') ? 'they are away this week'
    : flags.includes('over_hard') ? 'this would put them past their limit'
    : flags.includes('stretch') ? 'they hold none of the skills asked for'
    : flags.includes('at_max_concurrent') ? 'they are already juggling their maximum'
    : flags.includes('over_soft') ? 'it would push them into the warning band'
    : null;

  const lead = `Mostly ${strongest[2]}`;
  return caveat ? `${lead} — but ${caveat}.` : `${lead}.`;
}

/* ==========================================================================
 * THE RANKING, AND WHAT TO DO WHEN IT IS NO USE
 * ========================================================================== */

export type AdviceKind =
  | 'extend_deadline'
  | 'split_task'
  | 'rebalance'
  | 'override'
  | 'skill_gap';

export interface Advice {
  readonly kind: AdviceKind;
  readonly title: string;
  readonly detail: string;
}

export interface RecommendationResult {
  readonly ranked: readonly Recommendation[];
  /** True when even the best candidate is below the floor (FR-054). */
  readonly noGoodMatch: boolean;
  readonly advice: readonly Advice[];
  /** Skills nobody on the team holds above proficiency 3 — the hiring signal. */
  readonly skillGaps: readonly string[];
}

export function recommend(
  candidates: readonly Candidate[],
  task: TaskProfile,
  team: TeamContext,
): RecommendationResult {
  const ranked = candidates
    .map((candidate) => scoreCandidate(candidate, task, team))
    /* Score first, then name. Without the tiebreak the order of two equal
       candidates depends on the order rows came back from the database, which
       changes between page loads and looks like the engine changing its mind. */
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const skillGaps = task.requiredSkills
    .filter(
      (required) =>
        !candidates.some((candidate) =>
          candidate.skills.some((s) => s.skillId === required.skillId && s.proficiency >= 3),
        ),
    )
    .map((required) => required.label);

  const best = ranked[0]?.score ?? 0;
  const noGoodMatch = ranked.length === 0 || best < RECOMMENDATION_USABILITY_FLOOR;

  return {
    ranked,
    noGoodMatch,
    advice: noGoodMatch ? buildAdvice(ranked, task, team, skillGaps) : [],
    skillGaps,
  };
}

function buildAdvice(
  ranked: readonly Recommendation[],
  task: TaskProfile,
  team: TeamContext,
  skillGaps: readonly string[],
): Advice[] {
  const advice: Advice[] = [];
  const best = ranked[0];

  if (ranked.length === 0) {
    advice.push({
      kind: 'override',
      title: 'Nobody is assignable',
      detail:
        'Every candidate is inactive or outside your visibility. Check the team screen before forcing this through.',
    });
    return advice;
  }

  /* Ordered by how cheap the fix is, not by how clever it sounds. Moving a date
     costs a conversation; splitting a task costs planning; rebalancing costs
     somebody else's week. */
  if (task.daysToDue !== null && best.dimensions.deadlineFit < 60) {
    advice.push({
      kind: 'extend_deadline',
      title: 'Move the due date',
      detail: `The best fit is ${best.name}, and it is the deadline holding them back rather than their skills. A later date is the cheapest change here.`,
    });
  }

  if (task.loadPoints >= 8) {
    advice.push({
      kind: 'split_task',
      title: 'Split it into subtasks',
      detail:
        'A task this size has to land on one person whole. Two smaller pieces can go to two people who each have room.',
    });
  }

  if (best.projectedUtilisationPct > team.softThresholdPct) {
    advice.push({
      kind: 'rebalance',
      title: 'Free somebody up first',
      detail: `${best.name} would be at ${best.projectedUtilisationPct}%. Moving one low-priority task off them costs less than starting this one late.`,
    });
  }

  if (skillGaps.length > 0) {
    advice.push({
      kind: 'skill_gap',
      title: `Nobody is strong in ${skillGaps.join(', ')}`,
      detail:
        'Not a scheduling problem — the team is structurally thin here. Worth noting when this happens repeatedly.',
    });
  }

  advice.push({
    kind: 'override',
    title: 'Assign anyway, on the record',
    detail:
      'Sometimes the work simply has to happen. Doing it here records the reason and flags the risk rather than hiding it.',
  });

  return advice;
}

/* ==========================================================================
 * KEYWORD FALLBACK — FR-055
 * ========================================================================== */

/**
 * Guess required skills from the title and description when none are tagged.
 *
 * ── IT IS A SUGGESTION, AND IT SAYS SO ───────────────────────────────────────
 * Matches are returned separately from tagged skills so the UI can offer "Tag
 * this as video editing?" rather than quietly scoring against a guess. A hidden
 * inference that turns out wrong is indistinguishable from the engine being
 * broken, and the person can see the tags they set.
 *
 * Whole-word matching only. A substring match on `ai` fires on "detail",
 * "campaign" and "available", which is most of a creative brief.
 */
export function inferSkills(
  text: string,
  library: readonly { skillId: string; label: string; keywords: readonly string[] }[],
): Array<{ skillId: string; label: string; matched: string }> {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const found: Array<{ skillId: string; label: string; matched: string }> = [];

  for (const skill of library) {
    for (const keyword of skill.keywords) {
      const needle = keyword.toLowerCase().trim();
      if (!needle) continue;
      if (haystack.includes(` ${needle} `)) {
        found.push({ skillId: skill.skillId, label: skill.label, matched: needle });
        break;
      }
    }
  }

  return found;
}
