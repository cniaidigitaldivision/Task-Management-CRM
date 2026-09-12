-- ============================================================================
-- 132 · WHERE SOMEBODY LIVES
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-12: *"their address field is still missing. You can add it but
-- that should be optional."*
--
-- One nullable column, no default — the same catalogue-only change as 131, for
-- the same reason: every existing row keeps what it has, no table is rewritten,
-- and `createPerson` names its columns so nothing that already works notices.
--
-- ⚠️ FREE TEXT, NOT PARSED INTO PARTS. A house number / street / sector / city
-- split looks tidier and is wrong for Pakistan, where an address is as likely to
-- be "House 12-B, Street 4, G-11/3" as anything a form can decompose. Storing
-- what somebody types keeps it correct; splitting it makes it neat and false.
-- ============================================================================

alter table public.users
  add column if not exists address text;

comment on column public.users.address is
  'Where they live. Optional, free text, deliberately not split into parts.';

-- ============================================================================
-- SELF-CHECK — as with 131, the point is to prove nothing existing changed.
-- ============================================================================
do $$
declare
  n_before int;
  bad      int;
begin
  select count(*) into n_before from public.users;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'address'
  ) then
    raise exception '132 · the address column was not added';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users'
       and column_name = 'address' and is_nullable = 'NO'
  ) then
    raise exception '132 · address is NOT NULL — every existing row would be invalid';
  end if;

  select count(*) into bad from public.users where address is not null;
  if bad > 0 then
    raise exception '132 · % existing rows were given an address they did not have', bad;
  end if;

  raise notice '132 · address added, % existing rows untouched', n_before;
end $$;
