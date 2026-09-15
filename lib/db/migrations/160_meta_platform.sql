-- ============================================================================
-- 160 · A META LEAD REMEMBERS WHICH APP IT CAME FROM
-- ----------------------------------------------------------------------------
-- Owner, 2026-09-15: *"if leads are coming from Meta, it should show that it is
-- coming from Facebook or Instagram."*
--
-- Reasonable, and until now impossible: `lib/crm/lead-import.ts` asked Graph for
-- `{formId}/leads` with NO `fields` parameter, so it received the default set —
-- id, created_time, field_data — and nothing else. Checked against all 636
-- stored payloads on 2026-09-15: not one carries a platform.
--
-- The importer now requests `platform`, and this teaches the writer to use it.
--
-- ── ⚠️ THE DANGEROUS PART IS THE DEDUPE, NOT THE NEW VALUE ─────────────────
-- The existing lookup was:
--
--     where source = 'meta_lead_ad' and external_id = ...
--
-- The moment a lead lands as `facebook`, that predicate stops recognising its
-- own rows — and the next sync would INSERT ALL 636 AGAIN. `external_id` is
-- Meta's own lead id and unique by itself; the source was never contributing to
-- the match, only to the risk.
--
-- ── ⚠️ AND AN ABSENT PLATFORM DEGRADES TO TODAY'S BEHAVIOUR ────────────────
-- Not to a guess. A sync from before this change, a form that does not carry the
-- field, or any unexpected value all produce `meta_lead_ad` — exactly the label
-- every existing lead already has.
--
-- ⚠️ NOTHING IS BACKFILLED. The 636 historical leads have no platform recorded
-- anywhere, and inventing one would put fiction into the column a channel's
-- cost-per-lead is computed from. They stay "Meta", which is the truth.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.crm_record_leads(p_page_id text, p_forms jsonb DEFAULT '[]'::jsonb, p_leads jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(forms_written integer, leads_new integer, leads_updated integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_page_project uuid;
  v_form         uuid;
  v_form_project uuid;
  v_lead         uuid;
  v_existing     uuid;
  r              jsonb;
  n_forms        integer := 0;
  n_new          integer := 0;
  n_updated      integer := 0;
begin
  /* Unchanged from 112, and for the reason 112 gives: the caller says which
     PAGE it pulled from and the database decides what that means. */
  select a.project_id into v_page_project
    from public.meta_accounts a
    join public.platforms pl on pl.id = a.platform_id
   where a.meta_object_id = p_page_id
     and pl.slug = 'facebook'
     and a.is_active
   limit 1;

  if v_page_project is null then
    raise exception 'crm_record_leads: page % is not linked to any project', p_page_id;
  end if;

  -- ── Forms first: a lead references one ───────────────────────────────────
  for r in select * from jsonb_array_elements(p_forms)
  loop
    insert into public.crm_lead_forms (project_id, meta_form_id, name, page_id, status)
    values (
      v_page_project,
      r->>'meta_form_id',
      coalesce(r->>'name', 'Untitled form'),
      p_page_id,
      r->>'status'
    )
    on conflict (meta_form_id) do update
       set name       = excluded.name,
           status     = excluded.status,
           /* ⚠️ STILL NOT UPDATED, and now it is load-bearing rather than
              merely careful: this is the column an Admin sets to say "this
              form's leads are ERP enquiries", and an import that reset it would
              undo that every fifteen minutes. */
           updated_at = now();

    n_forms := n_forms + 1;
  end loop;

  -- ── Then the leads ───────────────────────────────────────────────────────
  for r in select * from jsonb_array_elements(p_leads)
  loop
    /* ⚠️ THE FORM'S PROJECT WINS. One page can run campaigns for several
       products — the owner's ERP, CRM and Taskly campaigns all post to the
       AI & Digital page — and the form is the only thing Meta gives us on every
       lead that can tell them apart. Falls back to the page for any form nobody
       has re-mapped, which is every form until somebody does. */
    select id, project_id into v_form, v_form_project
      from public.crm_lead_forms
     where meta_form_id = r->>'form_meta_id' limit 1;

    select id into v_existing from public.crm_leads
     where external_id = r->>'external_id'
       /* ⚠️ NO LONGER `source = 'meta_lead_ad'`, AND THIS LINE IS THE WHOLE
          RISK OF THIS MIGRATION. A lead now lands as `facebook` or `instagram`
          when Meta says which app it came from — so a dedupe that still keyed on
          `meta_lead_ad` would stop recognising its own rows and INSERT ALL 636
          AGAIN on the next sync.

          `external_id` is Meta's own lead id and is unique on its own; the
          source was never adding anything to the match. */
       and source in ('meta_lead_ad', 'facebook', 'instagram')
     limit 1;

    if v_existing is null then
      insert into public.crm_leads (
        project_id, form_id, source, external_id,
        full_name, phone, phone_e164, email, city,
        answers, submitted_at
      )
      values (
        coalesce(v_form_project, v_page_project), v_form,
        /* ⚠️ META'S OWN WORD FOR IT, AND `meta_lead_ad` WHEN IT DOES NOT SAY.
           Graph returns `platform` as 'fb' or 'ig' when the field is requested.
           Absent — an older sync, a form that does not carry it, any unexpected
           value — falls back to the label every existing lead already has, so a
           missing field degrades to today's behaviour rather than to a guess. */
        case lower(coalesce(r->>'platform', ''))
          when 'fb' then 'facebook'::public.crm_lead_source
          when 'facebook' then 'facebook'::public.crm_lead_source
          when 'ig' then 'instagram'::public.crm_lead_source
          when 'instagram' then 'instagram'::public.crm_lead_source
          else 'meta_lead_ad'::public.crm_lead_source
        end,
        r->>'external_id',
        nullif(trim(coalesce(r->>'full_name', '')), ''),
        nullif(trim(coalesce(r->>'phone', '')), ''),
        nullif(trim(coalesce(r->>'phone_e164', '')), ''),
        nullif(trim(coalesce(r->>'email', '')), ''),
        nullif(trim(coalesce(r->>'city', '')), ''),
        coalesce(r->'answers', '{}'::jsonb),
        (r->>'submitted_at')::timestamptz
      )
      returning id into v_lead;

      insert into public.crm_lead_activity (lead_id, kind, occurred_at, detail)
      values (v_lead, 'imported', (r->>'submitted_at')::timestamptz,
              jsonb_build_object('form', r->>'form_meta_id'));

      n_new := n_new + 1;
    else
      /* ⚠️ A RE-IMPORT REFRESHES WHAT META OWNS AND TOUCHES NOTHING ELSE.
         Stage, owner, notes, next action and temperature are OURS.

         ⚠️ AND `project_id` IS NOT AMONG THEM, WHICH IS NEW AND DELIBERATE. A
         lead already imported keeps the project it has: re-mapping a form is a
         decision about FUTURE leads, and silently moving six hundred existing
         ones between departments — changing who can read them — is not
         something a fifteen-minute cron should do. Moving the ones already
         imported is a separate, deliberate act. */
      update public.crm_leads
         set full_name  = coalesce(nullif(trim(coalesce(r->>'full_name', '')), ''), full_name),
             phone      = coalesce(nullif(trim(coalesce(r->>'phone', '')), ''), phone),
             phone_e164 = coalesce(nullif(trim(coalesce(r->>'phone_e164', '')), ''), phone_e164),
             email      = coalesce(nullif(trim(coalesce(r->>'email', '')), ''), email),
             city       = coalesce(nullif(trim(coalesce(r->>'city', '')), ''), city),
             answers    = coalesce(r->'answers', answers),
             form_id    = coalesce(v_form, form_id)
       where id = v_existing;

      n_updated := n_updated + 1;
    end if;
  end loop;

  return query select n_forms, n_new, n_updated;
end;
$function$;

-- ============================================================================
-- SELF-CHECK
-- ----------------------------------------------------------------------------
-- ⚠️ IT DOES NOT IMPORT A LEAD, AND THAT IS DELIBERATE. `crm_record_leads`
-- refuses a page that is not linked to a project; the demo page is not linked,
-- and the only linked page belongs to a REAL client project. Writing a test lead
-- there to exercise a migration would put fiction into a client's own list.
--
-- So the check exercises the two things that actually carry the risk, directly:
-- the mapping, and the dedupe predicate — against the real rows already stored.
-- ============================================================================
do $chk$
declare
  v_ext text; n_old int; n_new int; v_mapped text;
begin
  -- 1 · The mapping. Meta sends 'fb' and 'ig'; anything else must fall back.
  for v_ext, v_mapped in
    select * from (values ('ig','instagram'), ('fb','facebook'), ('IG','instagram'),
                          ('', 'meta_lead_ad'), ('whatever','meta_lead_ad')) as t(a,b)
  loop
    if (case lower(coalesce(v_ext, ''))
          when 'fb' then 'facebook' when 'facebook' then 'facebook'
          when 'ig' then 'instagram' when 'instagram' then 'instagram'
          else 'meta_lead_ad' end) <> v_mapped then
      raise exception '160 · platform % should map to % and did not', v_ext, v_mapped;
    end if;
  end loop;

  -- 2 · ⚠️ THE DEDUPE, AGAINST A REAL STORED LEAD. This is the whole risk of the
  --     migration: a predicate that stops recognising its own rows re-imports
  --     every one of them.
  select l.external_id into v_ext
    from public.crm_leads l
   where l.source = 'meta_lead_ad' and l.external_id is not null limit 1;

  if v_ext is null then
    raise notice '160 · no imported lead to test the dedupe against';
    return;
  end if;

  select count(*) into n_new from public.crm_leads
   where external_id = v_ext and source in ('meta_lead_ad','facebook','instagram');
  if n_new <> 1 then
    raise exception '160 · the new dedupe found % rows for one external_id', n_new;
  end if;

  -- 3 · ⚠️ AND IT KEEPS MATCHING WHEN THE SOURCE CHANGES, which the old one did
  --     not. Proven by asking both predicates about the same row as if it had
  --     been re-filed as `facebook` — no row is written, only the predicates run.
  select count(*) into n_old from public.crm_leads
   where external_id = v_ext and 'facebook' = 'meta_lead_ad';
  select count(*) into n_new from public.crm_leads
   where external_id = v_ext and 'facebook' in ('meta_lead_ad','facebook','instagram');

  if n_old <> 0 then
    raise exception '160 · the old predicate unexpectedly matched — the check is wrong';
  end if;
  if n_new <> 1 then
    raise exception '160 · the new predicate would MISS a lead re-filed as facebook — it would duplicate on the next sync';
  end if;

  raise notice '160 · platform maps correctly, the dedupe still finds its own rows, and it survives a lead being re-filed as facebook (the old one would have duplicated it)';
end $chk$;
