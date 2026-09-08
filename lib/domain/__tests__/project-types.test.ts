import { describe, expect, it } from 'vitest';

import {
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  hasSocialPresence,
  type ProjectType,
} from '../constants';

/* ============================================================================
 * PROJECT TYPES, AND THE ONE THAT DOES NOT POST
 * ----------------------------------------------------------------------------
 * `hasSocialPresence` is read in four places that each hide or skip something:
 * the "What was sold" section of the project form, the posting-rhythm checks in
 * `createProjectAction`, the Studio's project list, and the form's step
 * numbering. A wrong answer here does not throw — it silently removes a section
 * or silently demands a field that is no longer on screen, which is exactly how
 * tool projects became impossible to create for a day.
 * ========================================================================= */

describe('the project types', () => {
  it('includes tool, and every type has meta', () => {
    expect(PROJECT_TYPES).toContain('tool');
    for (const type of PROJECT_TYPES) {
      expect(PROJECT_TYPE_META[type]).toBeDefined();
      expect(PROJECT_TYPE_META[type].slug).toBe(type);
      expect(PROJECT_TYPE_META[type].code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('⚠️ a tool keeps the OTH prefix rather than taking a new one', () => {
    /* Three tool projects already carry OTH references on live tasks — migration
       107 moved them from `other` — and a reference is permanent. A new prefix
       would leave two codes meaning "tool" for ever, with the older one
       unexplainable to anybody who arrived later. */
    expect(PROJECT_TYPE_META.tool.code).toBe('OTH');
    expect(PROJECT_TYPE_META.other.code).toBe('OTH');
  });
});

describe('hasSocialPresence', () => {
  it('is false for a tool and true for everything else', () => {
    expect(hasSocialPresence('tool')).toBe(false);
    for (const type of PROJECT_TYPES.filter((t) => t !== 'tool')) {
      expect(hasSocialPresence(type)).toBe(true);
    }
  });

  it('⚠️ answers for every type, so a new one cannot arrive undecided', () => {
    /* The predicate takes a `ProjectType`, so TypeScript already forces a new
       member through it — this asserts the runtime answer is a real boolean
       rather than undefined, which would be falsy and quietly treat a new type
       as non-posting. */
    for (const type of PROJECT_TYPES as readonly ProjectType[]) {
      expect(typeof hasSocialPresence(type)).toBe('boolean');
    }
  });
});
