'use server';

/* ============================================================================
 * DEPARTMENTS — CREATE AND RENAME, FROM THE TEAM FORM
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-12: *"there should also be a button to create a department…
 * When a new department is added it will automatically be added to the
 * department drop-down."*
 *
 * Until now a department could only be created by writing a migration, which is
 * why four of the eight — Finance, HR, Operations, Support — exist as rows with
 * nobody in them and nothing ever filled them.
 *
 * ── ⚠️ NO NEW POLICY WAS NEEDED, AND NONE WAS ADDED ────────────────────────
 * `departments_write` has been `app.acting_at_least('admin')` for ALL commands
 * since migration 117. The database was always willing; only the UI was
 * missing. Adding a second rule saying the same thing would be two rules that
 * agree today and can disagree later.
 *
 * ── ⚠️ THERE IS NO DELETE, DELIBERATELY ────────────────────────────────────
 * `users.department_id` and `projects.lead_department_id` both point here.
 * Removing a department would either orphan people or, with the foreign keys as
 * they are, fail confusingly at the third attempt. Renaming covers the real
 * case, which is a typo; a department that is genuinely finished keeps its rows
 * and stops being chosen — the same stance the rest of this system takes with
 * anything that has history.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';

export interface DepartmentResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly id?: string;
  /** Echoed so a rejected dialog does not clear what was typed. */
  readonly name?: string;
}

/** Every department, for the dropdown. Ordered as the team page orders them. */
export async function listDepartmentsAction(): Promise<
  Array<{ id: string; key: string; name: string; people: number }>
> {
  const user = await requireUser();
  try {
    const rows = await withUser(user.id, (tx) => tx`
      select d.id, d.key, d.name,
             (select count(*) from public.users u
               where u.department_id = d.id and u.is_active) as people
        from public.departments d
       order by d.sort_order, d.name
    `);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      key: String(r.key),
      name: String(r.name),
      people: Number(r.people ?? 0),
    }));
  } catch {
    /* Fails closed to an empty list — the form then says so rather than
       rendering a dropdown that silently offers nothing. */
    return [];
  }
}

/**
 * A key from a name: `HR & People` → `hr_people`.
 *
 * ⚠️ THE KEY IS DERIVED ONCE AND NEVER AGAIN. Code compares against it —
 * `d.key = 'sales'` appeared in eleven policies before migration 124 — so a key
 * that changed when somebody fixed a typo in the NAME would silently rewrite
 * access rules. Renaming below deliberately leaves it alone.
 */
function keyFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export async function createDepartmentAction(name: string): Promise<DepartmentResult> {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return { ok: false, error: 'Only an Admin can add a department.', name };
  }

  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return { ok: false, error: 'Give the department a name.', name };
  if (clean.length > 60) return { ok: false, error: 'That name is too long — 60 characters at most.', name };

  const key = keyFrom(clean);
  if (!key) return { ok: false, error: 'That name has no letters or numbers in it.', name };

  try {
    const rows = await withUser(user.id, (tx) => tx`
      insert into public.departments (key, name, sort_order)
      values (
        ${key},
        ${clean},
        /* At the end of the list, so adding one never reorders what people are
           used to seeing. */
        (select coalesce(max(sort_order), 0) + 10 from public.departments)
      )
      returning id
    `);
    revalidatePath('/team');
    return { ok: true, id: String((rows[0] as Record<string, unknown>).id) };
  } catch (error) {
    /* 23505 is the unique violation on `key`. Named, because "that failed" sends
       somebody to look for a bug that is really a duplicate. */
    const message = String((error as { code?: string })?.code) === '23505'
      ? `A department called "${clean}" already exists.`
      : 'That department could not be created.';
    return { ok: false, error: message, name };
  }
}

export async function renameDepartmentAction(id: string, name: string): Promise<DepartmentResult> {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return { ok: false, error: 'Only an Admin can rename a department.', name };
  }

  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return { ok: false, error: 'Give the department a name.', name };
  if (clean.length > 60) return { ok: false, error: 'That name is too long — 60 characters at most.', name };

  try {
    /* ⚠️ `key` IS NOT TOUCHED. See `keyFrom` — the key is what code compares
       against, and rewriting it here would move access rules sideways every
       time somebody corrected a spelling. */
    const rows = await withUser(user.id, (tx) => tx`
      update public.departments
         set name = ${clean}, updated_at = now()
       where id = ${id}::uuid
      returning id
    `);
    if (rows.length === 0) return { ok: false, error: 'That department no longer exists.', name };
    revalidatePath('/team');
    return { ok: true, id };
  } catch {
    return { ok: false, error: 'That department could not be renamed.', name };
  }
}

/**
 * Who somebody could report to — active people, senior first.
 *
 * ⚠️ NOT FILTERED TO ONE DEPARTMENT. Somebody genuinely can report across one:
 * the sales manager may report to the CTO. Narrowing this to the chosen
 * department would quietly make the common case impossible to express, and the
 * field would then be wrong rather than empty.
 */
export async function listColleaguesAction(): Promise<
  Array<{ id: string; name: string; role: string; department: string | null }>
> {
  const user = await requireUser();
  try {
    const rows = await withUser(user.id, (tx) => tx`
      select u.id, u.full_name, u.role::text as role, d.name as department
        from public.users u
        left join public.departments d on d.id = u.department_id
       where u.is_active
       order by
         case u.role when 'super_admin' then 0 when 'admin' then 1
                     when 'team_coordinator' then 2 else 3 end,
         u.full_name
    `);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.full_name),
      role: String(r.role),
      department: r.department ? String(r.department) : null,
    }));
  } catch {
    return [];
  }
}
