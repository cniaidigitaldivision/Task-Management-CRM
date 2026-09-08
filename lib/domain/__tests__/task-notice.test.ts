import { describe, expect, it } from 'vitest';

import { noticeForStatus, notificationHref, taskLink, taskNotice } from '../task-notice';
import type { NoticeEvent, NoticeSubject } from '../task-notice';

/* ============================================================================
 * WHAT A NOTIFICATION SAYS, AND WHERE IT GOES
 * ----------------------------------------------------------------------------
 * The rule these exist to hold down is a negative one — *"don't mention those
 * codes"* — and a negative rule is exactly the kind that decays. Somebody adds
 * a tenth notification next month, reaches for the nearest example, and the
 * example they find is a template literal with a reference in it. So the ban is
 * asserted across EVERY event rather than on the three that carry it today.
 * ========================================================================= */

const SUBJECT: NoticeSubject = {
  taskId: '11111111-2222-3333-4444-555555555555',
  taskTitle: 'Eid sale post — Instagram',
  projectName: 'Chitral Royal Homes',
  actorName: 'Ayesha Khan',
};

/** One of each, so a new event has to be added here to compile. */
const EVERY_EVENT: readonly NoticeEvent[] = [
  { event: 'assigned' },
  { event: 'reassigned' },
  { event: 'review_requested' },
  { event: 'completed' },
  { event: 'approved' },
  { event: 'revisions', reason: 'The logo is the old one' },
  { event: 'revisions', reason: null },
  { event: 'blocked', reason: 'Waiting on the client' },
  { event: 'blocked', reason: null },
  { event: 'moved', statusLabel: 'In Progress' },
  { event: 'commented', excerpt: 'Can we push this to Friday?' },
];

describe('a notification never shows a reference code', () => {
  /* `CLI-091`, `BIZ-17`, `EVT-4` — the shape every reference takes. Matching
     the SHAPE rather than a fixed list is the point: a project code invented
     next year is caught by the same test. */
  const CODE = /\b[A-Z]{2,4}-\d+\b/;

  it.each(EVERY_EVENT.map((e) => [e.event, e] as const))(
    '%s carries neither a code in the title nor in the body',
    (_name, event) => {
      const notice = taskNotice(SUBJECT, event);
      expect(notice.title).not.toMatch(CODE);
      expect(notice.body).not.toMatch(CODE);
    },
  );

  it('says the task name and the project name, which is what replaced it', () => {
    for (const event of EVERY_EVENT) {
      const notice = taskNotice(SUBJECT, event);
      const both = `${notice.title} ${notice.body}`;
      expect(both).toContain(SUBJECT.taskTitle);
      /* ⚠️ NO EXCEPTIONS. The first version of this test excused the events
         whose body carries a reason or a comment excerpt, and the excuse hid
         the bug: a comment notification named no project at all. Both facts
         fit on the line — project first, then what was written. */
      expect(both).toContain(SUBJECT.projectName);
    }
  });
});

describe('the sentences themselves', () => {
  it('asks the reviewer for the thing that is wanted from them', () => {
    /* Owner: *"waiting for your review to move them to done"*. The old copy —
       "is ready for review" — described the task and left the reader to work
       out that they were the one being asked. */
    const notice = taskNotice(SUBJECT, { event: 'review_requested' });
    expect(notice.title).toContain('waiting for your review');
    expect(notice.body).toContain('Ayesha Khan');
  });

  it('tells the person who asked for the work that it is done, and by whom', () => {
    const notice = taskNotice(SUBJECT, { event: 'completed' });
    expect(notice.title).toContain('Eid sale post');
    expect(notice.title).toContain('done');
    expect(notice.body).toContain('completed by Ayesha Khan');
  });

  it('keeps the revision reason, behind the project it belongs to', () => {
    const notice = taskNotice(SUBJECT, { event: 'revisions', reason: 'The logo is the old one' });
    expect(notice.body).toBe('Chitral Royal Homes · The logo is the old one');
  });

  it('falls back to who sent it back when no reason was typed', () => {
    const notice = taskNotice(SUBJECT, { event: 'revisions', reason: '   ' });
    expect(notice.body).toContain('Chitral Royal Homes');
  });

  it('never produces a sentence that starts with a dash', () => {
    /* A task whose title is blank would otherwise notify somebody about
       "— waiting for your review", which is a notification about nothing. */
    const notice = taskNotice({ ...SUBJECT, taskTitle: '   ' }, { event: 'review_requested' });
    expect(notice.title).toBe('Untitled task — waiting for your review');
  });

  it('every notice links to the task itself', () => {
    for (const event of EVERY_EVENT) {
      expect(taskNotice(SUBJECT, event).linkTo).toBe(`/tasks?task=${SUBJECT.taskId}`);
    }
  });
});

describe('which notice a status change produces', () => {
  it('reads as approval to the person whose work was approved', () => {
    expect(noticeForStatus('done', null, 'Done')).toEqual({ event: 'approved' });
  });

  it('carries the reason for the two statuses that require one', () => {
    expect(noticeForStatus('revisions', 'Fix the caption', 'Revisions')).toEqual({
      event: 'revisions',
      reason: 'Fix the caption',
    });
    expect(noticeForStatus('blocked', 'Client silent', 'Blocked')).toEqual({
      event: 'blocked',
      reason: 'Client silent',
    });
  });

  it('otherwise just names the status it moved to', () => {
    expect(noticeForStatus('in_progress', null, 'In Progress')).toEqual({
      event: 'moved',
      statusLabel: 'In Progress',
    });
  });
});

describe('where a notification goes when it is clicked', () => {
  const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('opens the task, even for a row written before deep links existed', () => {
    /* The rescue case: everything already in the table links to `/my-work` and
       carries the task's id beside it. */
    expect(
      notificationHref({ kind: 'task_assigned', linkTo: '/my-work', entityId: TASK_ID }),
    ).toBe(`/tasks?task=${TASK_ID}`);
  });

  it('⚠️ does NOT treat a project notification as a task', () => {
    /* `entity_id` holds a PROJECT id here. Opening `/tasks?task=<project id>`
       would show a board filtered to a task that does not exist, which reads as
       data loss rather than a wrong link. */
    expect(
      notificationHref({
        kind: 'project_status_changed',
        linkTo: '/projects',
        entityId: 'a-project-id',
      }),
    ).toBe('/projects');
  });

  it('falls back to the stored link when there is no entity at all', () => {
    expect(notificationHref({ kind: 'security_alert', linkTo: '/security', entityId: null })).toBe(
      '/security',
    );
  });

  it('lands somewhere real even when a row has neither', () => {
    expect(notificationHref({ kind: 'task_comment', linkTo: null, entityId: null })).toBe('/tasks');
  });

  it('taskLink is the same shape the board already understands', () => {
    expect(taskLink(TASK_ID)).toBe(`/tasks?task=${TASK_ID}`);
  });
});
