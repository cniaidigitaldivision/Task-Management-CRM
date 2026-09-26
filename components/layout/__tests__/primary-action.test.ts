import { describe, expect, it } from 'vitest';

import { PRIMARY_ACTIONS, primaryActionFor } from '../primary-action';
import { ROLES, type Role } from '@/lib/domain/constants';

/* ============================================================================
 * THE TOP BAR'S BUTTON, AND THE BUG THAT MADE THIS FILE — 2026-09-26
 * ----------------------------------------------------------------------------
 * The Executive was given task work: the Tasks page opened for them, the
 * permission matrix allowed create and assign, migration 262 let the rows
 * through, and every test passed. Walking the app as one found the page with no
 * "New task" button on it.
 *
 * The cause was a hand-written list called EVERYONE that named four roles at a
 * time when there were four. Adding a fifth broke nothing and compiled
 * perfectly; the control simply was not offered. Nothing here could have caught
 * it, because nothing here could import a 500-line client component — which is
 * why the table now lives in a module of its own.
 * ========================================================================= */

describe('the page decides what the top bar creates', () => {
  it('offers "New task" to every role, the Executive included', () => {
    for (const role of ROLES) {
      expect(primaryActionFor('/tasks', role)?.label).toBe('New task');
    }
  });

  /* ⚠️ THE REAL GUARD. "Everyone" must be read off `ROLES`, never typed out, or
     the next role added is silently left without a button exactly as the
     Executive was. If this fails, somebody has re-written a literal list. */
  it('leaves nobody out of a create action meant for everybody', () => {
    const everyoneActions = Object.entries(PRIMARY_ACTIONS).filter(
      ([, action]) => action && action.roles.length === ROLES.length,
    );
    expect(everyoneActions.length).toBeGreaterThan(0);
    for (const [path, action] of everyoneActions) {
      expect([path, [...action!.roles].sort()]).toEqual([path, [...ROLES].sort()]);
    }
  });

  it('keeps projects and people to an Admin', () => {
    for (const role of ROLES) {
      const admin = role === 'super_admin' || role === 'admin';
      expect(Boolean(primaryActionFor('/projects', role))).toBe(admin);
      expect(Boolean(primaryActionFor('/team', role))).toBe(admin);
    }
  });

  /* A detail page inherits its section's action rather than falling through to
     the default — `/tasks/CNI-042` still offers "New task". */
  it('matches the longest path, so a detail page inherits its section', () => {
    expect(primaryActionFor('/tasks/CNI-042', 'executive' as Role)?.label).toBe('New task');
    expect(primaryActionFor('/settings/anything', 'admin' as Role)).toBeNull();
  });

  it('offers nothing on a page with nothing to create', () => {
    for (const path of ['/settings', '/reports', '/vault', '/workload', '/assistant']) {
      for (const role of ROLES) {
        expect(primaryActionFor(path, role)).toBeNull();
      }
    }
  });
});
