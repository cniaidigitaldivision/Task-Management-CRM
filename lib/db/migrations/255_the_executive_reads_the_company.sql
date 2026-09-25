-- ============================================================================
-- 255 · THE EXECUTIVE ROLE EXISTS (and three department roles beside it)
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-25, from the Solution Delivery and Governance table:
--
--     Executive — dashboards, forecasts, approvals and company-level reporting
--
-- ── ⚠️ THIS FILE ADDS THE VALUES AND NOTHING ELSE, ON PURPOSE ─────────────
-- `scripts/migrate.mjs` runs a whole file in ONE transaction, and PostgreSQL
-- refuses to USE an enum value that was added in the transaction still running
-- ("unsafe use of new value of enum type"). Ranking the new role, closing the
-- write doors and guarding who may grant it therefore live in 256, which runs
-- after this one has committed. Splitting them is not tidiness; it is the only
-- order that works.
--
-- ── ⚠️ ONE NEW user_role, NOT FOUR ───────────────────────────────────────
-- The owner's ladder reads Executive, Sales Manager, Marketer, Salesperson,
-- Support — but: *"Marketing will also be in a sales department and the support
-- role will also lie in a sales department."* So a Marketer is a MEMBER of the
-- Sales department whose DEPARTMENT role says what they do, exactly as the Sales
-- Manager already is today (`department_role = manager`). Only the Executive is
-- a company-wide rank, so only the Executive is a `user_role`.
--
-- That also keeps the 265 row-level policies out of it: a new department role
-- changes nobody's access, while a new user_role changes everybody's.
-- ============================================================================

-- ⚠️ `if not exists` so re-running this file is safe. An `add value` cannot be
-- rolled back once committed, which makes idempotence worth more here than
-- anywhere else in this folder.
alter type public.user_role add value if not exists 'executive';

/* Beside `manager` and `member`, which already exist. `salesperson` is named
   explicitly rather than left as `member`: the owner calls the job by its name,
   and a Sales department holding Marketing and Support needs to say which of
   the three a person actually is. */
alter type public.department_role add value if not exists 'salesperson';
alter type public.department_role add value if not exists 'marketing';
alter type public.department_role add value if not exists 'support';
