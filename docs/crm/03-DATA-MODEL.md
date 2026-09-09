# Data model — DRAFT

⚠️ **Nothing here is built.** This is the shape being proposed, written down so
the open questions in `05-OPEN-QUESTIONS.md` can be answered against something
concrete. Several columns change depending on those answers, and they are marked.

Migration numbers start at **110** (109 is the last applied).

---

## The shape, in one sentence

A **lead** is a person who responded to a **campaign**, belongs to a **project**,
is owned by a **staff member**, sits at a **stage**, has a **next action**, and
accumulates **activity**.

---

## `crm_leads`

The row the whole product is about.

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid → projects | ⚠️ Depends on Q3. Nullable if leads can arrive unassigned to a project. |
| `source` | enum | `meta_lead_ad`, `whatsapp`, `website`, `manual`, `import` |
| `external_id` | text | Meta's lead id. **Unique per source** — this is what makes the importer safe to run twice. |
| `form_id` / `form_name` | text | Which lead form produced it |
| `campaign_id` / `campaign_name` | text | ⚠️ Needs a second Meta call; see "Campaign attribution" below |
| `full_name` | text | Mapped from the form |
| `phone` | text | Mapped, and **normalised** — see below |
| `email` | text null | Often absent. The verified Chitral form has no email field. |
| `answers` | jsonb | **Every** field Meta returned, raw, keys and all |
| `stage` | enum | ⚠️ Q4 |
| `temperature` | enum null | `hot` / `warm` / `cold` — the 🔥 column |
| `owner_id` | uuid → users null | The staff member. Null = unassigned. |
| `next_action_at` | timestamptz null | What the list sorts by |
| `next_action` | text null | "Follow up", "Call back", "Send quotation" |
| `submitted_at` | timestamptz | Meta's `created_time`, **not** when we imported it |
| `imported_at` | timestamptz | Ours |
| `created_by_id` | uuid → users null | Null for imported leads |

### ⚠️ Why `answers` is jsonb and not columns

Verified 2026-09-09: the field keys Meta returns are whatever the advertiser
typed — `which__size_are_you_interested_in?_`, punctuation included. Every new
form invents new keys. A column per question would need a migration per campaign.

So: the two or three fields the CRM *acts* on get real columns (name, phone), and
the rest is kept whole. Nothing is discarded — a question asked in July is still
readable in December.

### ⚠️ Phone normalisation is not cosmetic

The same person fills two forms and types `0300-1234567` once and `+92 300
1234567` the next time. Without a normalised form there is no duplicate
detection, no WhatsApp link that works, and two staff members ring the same
person. Store both: `phone` as typed, `phone_e164` derived, indexed.

---

## `crm_lead_notes`

The owner asked for this by name, with the reason: *"maybe he forgets that… he
should properly note what quotation I have given him."*

| Column | Note |
|---|---|
| `id`, `lead_id`, `author_id`, `body`, `created_at` | |

Deliberately the same shape as `project_remarks` (migration 104), including the
lesson learned there: **a soft delete via `deleted_at` does not work when the
SELECT policy filters on it** — PostgreSQL applies SELECT policies to the NEW row
of an UPDATE, so a row cannot be updated into invisibility. Withdrawal is a real
DELETE.

---

## `crm_lead_activity`

Everything that happened, in one timeline. This is what an AI summary would later
read, and what the "Call – Contacted Client · 9 days ago" column renders from.

| Column | Note |
|---|---|
| `id`, `lead_id`, `actor_id` | |
| `kind` | `call_attempted`, `call_connected`, `whatsapp_sent`, `email_sent`, `stage_changed`, `assigned`, `note_added` |
| `outcome` | text null — "no answer", "wrong number", "asked to call Friday" |
| `occurred_at` | Not `created_at`: a call logged an hour later happened an hour ago |

⚠️ **Append-only.** No UPDATE or DELETE policy, like `report_exports`. An activity
log somebody can edit is not evidence of anything.

---

## `crm_lead_assignments` — or not

Two options, and the choice matters:

- **`owner_id` on the lead** — simple, one owner, reassignment overwrites.
- **A separate assignment table** — full history of who held it and when.

Recommend `owner_id` **plus** an `assigned` row in the activity log. That gives
the history without a second table to join on every list query, and the list
query is the one that has to be fast.

---

## Campaign attribution

Meta's `/leads` response does **not** include the campaign. Getting it needs the
ad id from the lead, then the ad → adset → campaign chain, which is a separate
Marketing API call and separate permissions.

**Recommendation:** store `form_id` and `form_name` in Phase 1 — they are free and
already returned — and add campaign resolution in Phase 3 when reporting needs
it. Blocking the importer on campaign attribution is how the 90-day clock wins.

---

## RLS — the part to get right before any of it is built

⚠️ Every rule here is **pending Q2**. What follows is the recommendation, not a
decision.

| Role | Proposed |
|---|---|
| Super Admin / Admin | Every lead |
| Team Coordinator | Every lead on projects they coordinate |
| Member (staff) | **Only leads assigned to them** |

Three specific traps, each one already paid for elsewhere in this codebase:

1. **`users_select` hides the staff table from a Member.** Any join that fetches
   an owner's name will return null for a Member and render as "Former member" —
   exactly the bug found on 2026-09-08 in the remarks modal. The fix is a
   SECURITY DEFINER reader scoped to the rows the caller can already see, never a
   wider `users_select`.
2. **The importer runs with no session.** RLS fails closed, so a cron insert
   returns zero rows and reports success. Every writer the cron uses must be
   SECURITY DEFINER, and its migration must self-check as `cni_app` with
   `app.user_id` unset.
3. **A CHECK constraint passes when its expression is NULL.** Learned on
   migration 107. Any "this column is required when that one is set" rule needs
   an explicit `is not null`, or it accepts exactly the row it exists to refuse.
