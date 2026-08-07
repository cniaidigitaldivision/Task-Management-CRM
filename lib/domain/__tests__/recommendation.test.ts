import { describe, expect, it } from 'vitest';

import {
  RECOMMENDATION_USABILITY_FLOOR,
  SCORE_WEIGHTS,
  sumScoreWeights,
} from '../constants';
import {
  availabilityScore,
  deadlineFitScore,
  fairnessScore,
  familiarityScore,
  inferSkills,
  performanceScore,
  projectedUtilisation,
  recommend,
  scoreCandidate,
  skillScore,
  type Candidate,
  type TaskProfile,
  type TeamContext,
} from '../recommendation';

/* ============================================================================
 * ASSIGNMENT RECOMMENDATIONS — doc 07
 * ----------------------------------------------------------------------------
 * doc 07 §3 gives worked numbers for the skill dimension, so those are asserted
 * against the document directly. The rest are asserted against the behaviour
 * the document describes in prose — particularly the cases where an obvious
 * implementation produces the opposite of what is intended: an untagged skill
 * list scoring everybody zero, and a fairness term that punishes an even split.
 * ========================================================================= */

const person = (over: Partial<Candidate> = {}): Candidate => ({
  userId: 'u1',
  name: 'Kashif Ahmed',
  roleTitle: 'Senior Video Editor',
  skills: [],
  currentLoadPoints: 12,
  effectiveCapacityPoints: 36,
  activeTaskCount: 2,
  maxConcurrentTasks: 5,
  committedBeforeDuePoints: 6,
  recentAssignments: 2,
  completedCount: 20,
  onTimeRate: 0.9,
  revisionRate: 0.1,
  openTasksInProject: 0,
  hasWorkedOnProject: false,
  ...over,
});

const job = (over: Partial<TaskProfile> = {}): TaskProfile => ({
  requiredSkills: [],
  loadPoints: 4,
  daysToDue: 5,
  ...over,
});

const team = (over: Partial<TeamContext> = {}): TeamContext => ({
  totalRecentAssignments: 14,
  teamSize: 7,
  softThresholdPct: 85,
  hardThresholdPct: 100,
  ...over,
});

describe('S1 · skill match — doc 07 §3', () => {
  const required = [
    { skillId: 'video', label: 'Video editing', weight: 3 },
    { skillId: 'motion', label: 'Motion graphics', weight: 1 },
  ];

  it('reproduces the document’s worked example for Kashif', () => {
    // (3 × 5/5 + 1 × 4/5) / 4 × 100 = 95
    expect(
      skillScore(required, [
        { skillId: 'video', proficiency: 5 },
        { skillId: 'motion', proficiency: 4 },
      ]),
    ).toBe(95);
  });

  it('reproduces it for Member C', () => {
    // (3 × 2/5 + 1 × 3/5) / 4 × 100 = 45
    expect(
      skillScore(required, [
        { skillId: 'video', proficiency: 2 },
        { skillId: 'motion', proficiency: 3 },
      ]),
    ).toBe(45);
  });

  it('is zero for somebody holding neither', () => {
    expect(skillScore(required, [])).toBe(0);
  });

  it('weights the essential skill more than the nice-to-have', () => {
    const onlyEssential = skillScore(required, [{ skillId: 'video', proficiency: 5 }]);
    const onlyNice = skillScore(required, [{ skillId: 'motion', proficiency: 5 }]);
    expect(onlyEssential).toBeGreaterThan(onlyNice);
    expect(onlyEssential).toBe(75);
    expect(onlyNice).toBe(25);
  });

  it('scores everybody 100 when the task asks for nothing', () => {
    /* THE CASE AN OBVIOUS IMPLEMENTATION GETS BACKWARDS. Zero would make the
       heaviest dimension punish the whole team for a tagging omission, and the
       ranking would then be decided by availability while appearing to be
       about skill. */
    expect(skillScore([], [])).toBe(100);
    expect(skillScore([], [{ skillId: 'video', proficiency: 5 }])).toBe(100);
  });

  it('ignores skills the task did not ask for', () => {
    expect(skillScore(required, [
      { skillId: 'video', proficiency: 5 },
      { skillId: 'motion', proficiency: 4 },
      { skillId: 'copywriting', proficiency: 5 },
    ])).toBe(95);
  });

  it('clamps a proficiency outside 1–5 rather than exceeding 100', () => {
    expect(skillScore(required, [
      { skillId: 'video', proficiency: 50 },
      { skillId: 'motion', proficiency: 50 },
    ])).toBe(100);
  });
});

describe('S2 · availability headroom — doc 07 §3', () => {
  it('matches the document’s table', () => {
    expect(availabilityScore(35)).toBe(65);
    expect(availabilityScore(60)).toBe(40);
    expect(availabilityScore(85)).toBe(15);
    expect(availabilityScore(100)).toBe(0);
  });

  it('does not go negative past 100%', () => {
    expect(availabilityScore(180)).toBe(0);
  });

  it('projects the task’s own cost, not just the current load', () => {
    // 12 committed + 6 incoming, over 36 = 50%
    expect(projectedUtilisation(person(), 6)).toBe(50);
  });

  it('reports 100% for somebody with no capacity, rather than infinity', () => {
    expect(projectedUtilisation(person({ effectiveCapacityPoints: 0 }), 4)).toBe(100);
  });
});

describe('S3 · deadline fit — doc 07 §3', () => {
  it('is full marks when free capacity comfortably covers the task', () => {
    expect(deadlineFitScore(person({ committedBeforeDuePoints: 6 }), job({ loadPoints: 4 }))).toBe(
      100,
    );
  });

  it('falls when the week before the deadline is already committed', () => {
    /* THE CASE S2 CANNOT SEE. This person is at 33% overall and still wrong for
       a Wednesday deadline, because everything they hold is due first. */
    const score = deadlineFitScore(
      person({ committedBeforeDuePoints: 34 }),
      job({ loadPoints: 4 }),
    );
    expect(score).toBe(50);
  });

  it('is zero when nothing is free before the date', () => {
    expect(deadlineFitScore(person({ committedBeforeDuePoints: 40 }), job())).toBe(0);
  });

  it('is zero for a task already due or overdue', () => {
    expect(deadlineFitScore(person(), job({ daysToDue: 0 }))).toBe(0);
    expect(deadlineFitScore(person(), job({ daysToDue: -3 }))).toBe(0);
  });

  it('is 100 when there is no due date at all', () => {
    /* Scoring 0 would silently penalise every undated task, which is most of a
       backlog. */
    expect(deadlineFitScore(person(), job({ daysToDue: null }))).toBe(100);
  });
});

describe('S4 · fairness — doc 07 §3', () => {
  it('gives everybody 100 on a perfectly even split', () => {
    /* The document states this outcome explicitly, and its literal formula
       produces 0 for it. The behaviour is what the document means and what §3's
       own table asserts. */
    expect(fairnessScore(2, 14, 7)).toBe(100);
  });

  it('rewards somebody who has had less than their share', () => {
    expect(fairnessScore(0, 14, 7)).toBe(100);
    expect(fairnessScore(1, 14, 7)).toBe(100);
  });

  it('penalises somebody absorbing more than their share', () => {
    expect(fairnessScore(3, 14, 7)).toBeLessThan(100);
    expect(fairnessScore(4, 14, 7)).toBe(0);
  });

  it('bottoms out rather than going negative', () => {
    expect(fairnessScore(14, 14, 7)).toBe(0);
  });

  it('is neutral when nothing has been assigned to anybody', () => {
    /* No information. Inventing some would rank a quiet week arbitrarily. */
    expect(fairnessScore(0, 0, 7)).toBe(100);
  });

  it('does not divide by zero on an empty team', () => {
    expect(fairnessScore(0, 5, 0)).toBe(100);
  });
});

describe('S5 · past performance — doc 07 §3', () => {
  it('follows the formula', () => {
    // 0.9 × 70 + 0.9 × 30 = 90
    expect(performanceScore(person({ onTimeRate: 0.9, revisionRate: 0.1 }))).toBe(90);
  });

  it('gives a new member a neutral 75 rather than punishing them', () => {
    /* Somebody with two completed tasks and one late one would otherwise score
       35 on no evidence at all. */
    expect(performanceScore(person({ completedCount: 2, onTimeRate: 0.5 }))).toBe(75);
    expect(performanceScore(person({ completedCount: 0, onTimeRate: 0 }))).toBe(75);
  });

  it('applies once there is enough history', () => {
    expect(performanceScore(person({ completedCount: 5, onTimeRate: 1, revisionRate: 0 }))).toBe(
      100,
    );
  });

  it('weighs punctuality above revisions, 70 to 30', () => {
    const punctualButRevised = performanceScore(
      person({ completedCount: 10, onTimeRate: 1, revisionRate: 1 }),
    );
    const lateButClean = performanceScore(
      person({ completedCount: 10, onTimeRate: 0, revisionRate: 0 }),
    );
    expect(punctualButRevised).toBe(70);
    expect(lateButClean).toBe(30);
  });
});

describe('S6 · project familiarity — doc 07 §3', () => {
  it('follows the formula', () => {
    expect(familiarityScore(person({ openTasksInProject: 2, hasWorkedOnProject: true }))).toBe(80);
  });

  it('is zero for somebody new to the project', () => {
    expect(familiarityScore(person())).toBe(0);
  });

  it('caps at 100', () => {
    expect(familiarityScore(person({ openTasksInProject: 9, hasWorkedOnProject: true }))).toBe(100);
  });
});

describe('the weighted score', () => {
  it('uses weights that sum to exactly 1.00', () => {
    /* The C-06 guard, restated where the weights are actually consumed. They
       were once 1.05 and inflated every score by 5%. */
    expect(sumScoreWeights(SCORE_WEIGHTS)).toBeCloseTo(1, 10);
  });

  it('scores a perfect candidate at 100', () => {
    const result = scoreCandidate(
      person({
        currentLoadPoints: 0,
        committedBeforeDuePoints: 0,
        recentAssignments: 0,
        completedCount: 20,
        onTimeRate: 1,
        revisionRate: 0,
        openTasksInProject: 4,
        hasWorkedOnProject: true,
        skills: [{ skillId: 'video', proficiency: 5 }],
      }),
      job({ requiredSkills: [{ skillId: 'video', label: 'Video', weight: 3 }], loadPoints: 0 }),
      team(),
    );
    expect(result.score).toBe(100);
    expect(result.flags).toHaveLength(0);
  });

  it('deducts the over-hard penalty and flags it', () => {
    const result = scoreCandidate(
      person({ currentLoadPoints: 40, effectiveCapacityPoints: 36 }),
      job(),
      team(),
    );
    expect(result.flags).toContain('over_hard');
    expect(result.penaltyPoints).toBeLessThanOrEqual(-40);
  });

  it('applies the soft penalty rather than the hard one in the warning band', () => {
    const result = scoreCandidate(
      person({ currentLoadPoints: 30, effectiveCapacityPoints: 36 }),
      job({ loadPoints: 2 }),
      team(),
    );
    expect(result.flags).toContain('over_soft');
    expect(result.flags).not.toContain('over_hard');
  });

  it('flags somebody on leave and penalises heavily', () => {
    const result = scoreCandidate(person({ effectiveCapacityPoints: 0 }), job(), team());
    expect(result.flags).toContain('unavailable');
    expect(result.score).toBeLessThan(RECOMMENDATION_USABILITY_FLOOR);
  });

  it('flags a stretch when they hold none of the required skills', () => {
    const result = scoreCandidate(
      person({ skills: [] }),
      job({ requiredSkills: [{ skillId: 'video', label: 'Video', weight: 3 }] }),
      team(),
    );
    expect(result.flags).toContain('stretch');
  });

  it('does not flag a stretch when the task asks for nothing', () => {
    /* Otherwise every untagged task marks the entire team as a stretch. */
    expect(scoreCandidate(person(), job(), team()).flags).not.toContain('stretch');
  });

  it('flags being at the concurrent limit, which volume alone would miss', () => {
    const result = scoreCandidate(
      person({ activeTaskCount: 5, maxConcurrentTasks: 5, currentLoadPoints: 4 }),
      job(),
      team(),
    );
    expect(result.flags).toContain('at_max_concurrent');
  });

  it('never returns a negative score', () => {
    const result = scoreCandidate(
      person({
        effectiveCapacityPoints: 1,
        currentLoadPoints: 50,
        activeTaskCount: 9,
        maxConcurrentTasks: 2,
        skills: [],
        completedCount: 20,
        onTimeRate: 0,
        revisionRate: 1,
      }),
      job({ requiredSkills: [{ skillId: 'video', label: 'Video', weight: 3 }] }),
      team(),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('explains itself in a sentence naming the caveat', () => {
    const result = scoreCandidate(
      person({ currentLoadPoints: 40, effectiveCapacityPoints: 36 }),
      job(),
      team(),
    );
    expect(result.why).toContain('past their limit');
  });

  it('honours custom weights, so the settings screen means something', () => {
    const skilled = person({ skills: [{ skillId: 'video', proficiency: 5 }] });
    const required = job({ requiredSkills: [{ skillId: 'video', label: 'Video', weight: 3 }] });

    const skillHeavy = scoreCandidate(skilled, required, {
      ...team(),
      weights: {
        skill: 1,
        availability: 0,
        deadlineFit: 0,
        fairness: 0,
        performance: 0,
        projectFamiliarity: 0,
      },
    });
    expect(skillHeavy.dimensions.skill).toBe(100);
    expect(skillHeavy.score).toBe(100);
  });
});

describe('recommend', () => {
  const required = job({
    requiredSkills: [{ skillId: 'video', label: 'Video editing', weight: 3 }],
  });

  it('ranks the better fit first', () => {
    const result = recommend(
      [
        person({ userId: 'a', name: 'Alpha', skills: [] }),
        person({ userId: 'b', name: 'Beta', skills: [{ skillId: 'video', proficiency: 5 }] }),
      ],
      required,
      team(),
    );
    expect(result.ranked[0].userId).toBe('b');
  });

  it('breaks a tie by name, so the order does not wander between page loads', () => {
    const result = recommend(
      [
        person({ userId: 'z', name: 'Zoya' }),
        person({ userId: 'a', name: 'Ayesha' }),
      ],
      job(),
      team(),
    );
    expect(result.ranked.map((r) => r.name)).toEqual(['Ayesha', 'Zoya']);
  });

  it('stops recommending people when nobody clears the floor (FR-054)', () => {
    const result = recommend(
      [
        person({ userId: 'a', name: 'Alpha', effectiveCapacityPoints: 0, skills: [] }),
        person({ userId: 'b', name: 'Beta', effectiveCapacityPoints: 0, skills: [] }),
      ],
      required,
      team(),
    );
    expect(result.noGoodMatch).toBe(true);
    expect(result.advice.length).toBeGreaterThan(0);
  });

  it('offers advice ordered cheapest first, ending with the override', () => {
    const result = recommend(
      [person({ effectiveCapacityPoints: 2, currentLoadPoints: 10, skills: [] })],
      job({ ...required, loadPoints: 12, daysToDue: 2 }),
      team(),
    );
    expect(result.advice[result.advice.length - 1].kind).toBe('override');
  });

  it('names a skill gap when nobody is above proficiency 3', () => {
    /* The quietly valuable one: over time this is a hiring signal drawn out of
       ordinary task data. */
    const result = recommend(
      [person({ skills: [{ skillId: 'video', proficiency: 2 }] })],
      required,
      team(),
    );
    expect(result.skillGaps).toEqual(['Video editing']);
  });

  it('reports no gap when somebody is strong enough', () => {
    const result = recommend(
      [person({ skills: [{ skillId: 'video', proficiency: 4 }] })],
      required,
      team(),
    );
    expect(result.skillGaps).toHaveLength(0);
  });

  it('handles an empty candidate list without crashing', () => {
    const result = recommend([], required, team());
    expect(result.ranked).toHaveLength(0);
    expect(result.noGoodMatch).toBe(true);
    expect(result.advice[0].kind).toBe('override');
  });

  it('says nothing when there is a good match', () => {
    const result = recommend(
      [
        person({
          skills: [{ skillId: 'video', proficiency: 5 }],
          currentLoadPoints: 4,
          recentAssignments: 0,
        }),
      ],
      required,
      team(),
    );
    expect(result.noGoodMatch).toBe(false);
    expect(result.advice).toHaveLength(0);
  });
});

describe('inferSkills — FR-055 keyword fallback', () => {
  const library = [
    { skillId: 'video', label: 'Video editing', keywords: ['reel', 'edit', 'premiere'] },
    { skillId: 'design', label: 'Graphic design', keywords: ['poster', 'logo'] },
    { skillId: 'ai', label: 'AI', keywords: ['ai', 'llm'] },
  ];

  it('finds the document’s own example', () => {
    const found = inferSkills('Edit the Ramadan reel in Premiere', library);
    expect(found.map((f) => f.skillId)).toContain('video');
  });

  it('matches whole words only', () => {
    /* A substring match on "ai" fires on detail, campaign and available —
       which is most of a creative brief. */
    const found = inferSkills('Available detail for the campaign', library);
    expect(found.map((f) => f.skillId)).not.toContain('ai');
  });

  it('still matches a short keyword standing alone', () => {
    expect(inferSkills('Build an AI assistant', library).map((f) => f.skillId)).toContain('ai');
  });

  it('is case-insensitive and ignores punctuation', () => {
    expect(inferSkills('REEL, urgently!', library).map((f) => f.skillId)).toContain('video');
  });

  it('reports each skill once, not once per matching keyword', () => {
    const found = inferSkills('edit the reel in premiere', library);
    expect(found.filter((f) => f.skillId === 'video')).toHaveLength(1);
  });

  it('finds nothing in text with no keywords', () => {
    expect(inferSkills('Attend the Tuesday stand-up', library)).toHaveLength(0);
  });

  it('copes with empty text and an empty library', () => {
    expect(inferSkills('', library)).toHaveLength(0);
    expect(inferSkills('reel', [])).toHaveLength(0);
  });
});
