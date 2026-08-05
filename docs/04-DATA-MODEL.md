# 04 — Data Model

Database: **PostgreSQL via Supabase** ([ADR-001](decisions/ADR-001-tech-stack.md)).
Naming: `snake_case` tables and columns, plural table names, `id` = UUID primary key.

> **Session 04 note:** the ERD below predates the projects, timer, security and theme tables and is now **indicative only**. The authoritative table list is [doc 19 §6](19-MASTER-SPECIFICATION-REGISTRY.md#6-table-registry--owner-doc-04); which module may write each table is defined in [doc 20 §2](20-IMPLEMENTATION-CONTRACTS.md#2-module-ownership--who-owns-which-tables). (Contradiction C-07.)
>
> **`users` also carries `theme`** (`light` | `dark` | `system`, default `system`) per FR-202.

---

## 1. Entity relationship overview

```
                  ┌──────────────┐
                  │    users     │
                  └──────┬───────┘
                         │ 1
        ┌────────────────┼─────────────────┬───────────────────┐
        │ n              │ n               │ n                 │ n
┌───────▼────────┐ ┌─────▼────────┐ ┌──────▼──────┐  ┌─────────▼────────┐
│ user_skills    │ │ availability │ │  tasks      │  │  notifications   │
│  (skill+level) │ │  (leave)     │ │ (assignee)  │  │                  │
└───────┬────────┘ └──────────────┘ └──────┬──────┘  └──────────────────┘
        │ n                                │ 1
┌───────▼────────┐                 ┌───────┼──────────┬──────────┬────────────┐
│    skills      │                 │ n     │ n        │ n        │ n          │
└────────────────┘          ┌──────▼───┐ ┌─▼───────┐ ┌▼────────┐ ┌▼──────────┐
                            │ comments │ │task_    │ │task_    │ │time_logs  │
┌──────────────┐            └──────────┘ │skills   │ │watchers │ └───────────┘
│  projects    │──1────n─── tasks        └─────────┘ └─────────┘
│  (clients)   │                    │
└──────────────┘            ┌───────▼────────┐  ┌──────────────┐  ┌───────────┐
                            │ attachments    │  │ dependencies │  │ activity_ │
                            └────────────────┘  └──────────────┘  │   log     │
                                                                  └───────────┘
                            ┌──────────────┐  ┌──────────────────┐
                            │  statuses    │  │ system_settings  │
                            └──────────────┘  └──────────────────┘
```

---

## 2. Tables

### `users`
The whole team. One row per person, regardless of role.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `full_name` | text | "Kashif Ahmed" |
| `email` | text unique | login identity |
| `avatar_url` | text null | |
| `organisation_id` | uuid FK | **On every table.** Single org today; makes multi-tenancy a config change later. See doc 16 §13, Q-034. |
| `role` | enum | `super_admin` \| `admin` \| `team_coordinator` \| `member` — **4 roles, per ADR-002** |
| `role_title` | text | Human job title: "Video Editor", "Ads Manager" |
| `account_state` | enum | `pending_activation` \| `active` \| `password_reset_required` \| `mfa_setup_required` \| `locked` \| `suspended` \| `deactivated` (doc 16 §3) |
| `weekly_capacity_points` | int | **default 36** — see ADR-004 for why not 48 |
| `max_concurrent_tasks` | int | default 5. Secondary overload guard. |
| `timezone` | text | default team timezone |
| `theme` | enum | `light` \| `dark` \| `system` — default `system` (FR-202) |
| `is_active` | boolean | false = deactivated, cannot log in |
| `phone` | text null | for optional WhatsApp notifications |
| `notification_prefs` | jsonb | per-channel, per-event mutes |
| `created_at` / `updated_at` | timestamptz | |

### `skills`
The skills library. Editable by Admin (FR-017).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique | `video-editing`, `ads-management`, `ui-design` |
| `label` | text | "Video Editing" |
| `category` | text null | "Creative", "Marketing", "Technical" |
| `keywords` | text[] | For fallback text matching (FR-055): `{video, reel, edit, premiere, footage}` |

### `user_skills`
Which person can do what, and how well. **This is what makes assignment intelligent.**

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid FK → users | |
| `skill_id` | uuid FK → skills | |
| `proficiency` | int 1–5 | 5 = expert, 3 = capable, 1 = can help |
| `is_primary` | boolean | Their headline specialty |
| PK | (`user_id`, `skill_id`) | |

**Example — Kashif:** `video-editing:5 (primary)`, `motion-graphics:4`, `thumbnail-design:3`
**Example — Yusra:** `ads-management:5 (primary)`, `ad-copywriting:4`, `analytics-reporting:3`

### `projects` — **REQUIRED in v1** (ADR-006, doc 15)
Every task belongs to exactly one project. No orphan tasks.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid FK | |
| `name` | text | "Expo Karachi — Oct 2026" |
| `type` | enum | **`event` \| `client` \| `business` \| `self_promotion` \| `other`** |
| `code` | text | Reference prefix: `EVT` \| `CLI` \| `BIZ` \| `PRM` \| `OTH` (Q-026) |
| `description` | text null | |
| `colour` | text | UI chips |
| `status` | enum | `planning` \| `active` \| `on_hold` \| `completed` \| `archived` \| `cancelled` |
| `status_reason` | text null | required for on_hold and cancelled |
| `owner_id` | uuid FK → users | |
| `start_date` / `end_date` | date null | |
| `is_permanent` | boolean | true for the always-present "Misc / Ad-hoc" Other project (Q-024) |
| `type_fields` | jsonb | **type-specific fields — see below** |
| `created_by_id` | uuid FK | |
| `is_deleted` / `deleted_at` | | soft delete |

**`type_fields` contents by type:**

| Type | Keys |
|---|---|
| `event` | `event_date`, `venue`, `deliverables_due_offset_days`, `linked_client_project_id`, `expected_scale` |
| `client` | `client_name`, `contact_person`, `contact_email`, `contact_phone`, `engagement_type`, `retainer_hours_per_month`, `contract_start`, `contract_end`, `is_billable`, `priority_tier` |
| `business` | `objective`, `area`, `target_completion` |
| `self_promotion` | `channel`, `campaign_goal`, `target_publish_date` |
| `other` | `requested_by`, `reason_not_a_project` |

> Type-specific fields live in `jsonb` rather than 30 mostly-null columns. They are validated by a Zod schema per type at the application layer, so the flexibility doesn't cost correctness.

### `project_members` *(derived, materialised for query speed)*
Who is working on what. Drives member project visibility (BR-016) and the project-familiarity assignment factor (FR-117).

| Column | Type |
|---|---|
| `project_id` uuid FK, `user_id` uuid FK, `task_count` int, `points_consumed` numeric, `first_assigned_at` timestamptz |

### `statuses`
Configurable workflow (FR-044). Seeded with the default set from doc 05.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique | `in_progress` |
| `label` | text | "In Progress" |
| `colour` | text | |
| `sort_order` | int | left-to-right on the board |
| `category` | enum | `not_started` \| `active` \| `waiting` \| `done` \| `cancelled` — drives capacity maths |
| `counts_toward_load` | boolean | Done/Cancelled = false |
| `requires_reason` | boolean | true for Blocked |
| `approval_required_to_exit` | boolean | true for In Review |

### `tasks`
The core table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `reference` | text unique | `CNI-142` (FR-032) |
| `title` | text | |
| `description` | text null | rich text / markdown |
| `project_id` | uuid FK **NOT NULL** | Every task belongs to a project (BR-011) |
| `other_description` | text null | **Mandatory when the project type is `other`** (BR-012). "What is this work?" |
| `parent_task_id` | uuid FK null | non-null = subtask (FR-026) |
| `assignee_id` | uuid FK null | one assignee (BR-001) |
| `created_by_id` | uuid FK | |
| `status_id` | uuid FK → statuses | |
| `priority` | enum | `low` \| `medium` \| `high` \| `urgent` |
| `effort_points` | numeric | the capacity cost — see doc 06 |
| `effort_size` | enum null | `XS`\|`S`\|`M`\|`L`\|`XL` shortcut that fills effort_points |
| `start_date` | date null | |
| `due_date` | date null | |
| `completed_at` | timestamptz null | |
| `blocked_reason` | text null | mandatory when status = Blocked (FR-043) |
| `assignment_override_reason` | text null | set when hard threshold was overridden (BR-003) |
| `assignment_score` | numeric null | the smart-engine score at time of assignment, for later tuning |
| `recurrence_rule` | text null | RRULE string for recurring tasks (FR-029) |
| `is_deleted` | boolean | soft delete |
| `deleted_at` | timestamptz null | 30-day purge window (FR-095) |
| `created_at` / `updated_at` | timestamptz | |

### `task_skills`
What the task *needs*. Drives the match score.

| Column | Type |
|---|---|
| `task_id` uuid FK, `skill_id` uuid FK, `weight` int 1–3 (how essential) |

### `task_watchers`
People who want updates but aren't the assignee.

| Column | Type |
|---|---|
| `task_id` uuid FK, `user_id` uuid FK |

### `task_dependencies` (FR-028)

| Column | Type | Notes |
|---|---|---|
| `task_id` | uuid FK | the blocked task |
| `depends_on_task_id` | uuid FK | must finish first |
| `type` | enum | `blocks` \| `relates_to` |

### `checklist_items` (FR-027)

| Column | Type |
|---|---|
| `id` uuid PK, `task_id` uuid FK, `text` text, `is_done` boolean, `sort_order` int |

### `comments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `task_id` | uuid FK | |
| `author_id` | uuid FK | |
| `body` | text | |
| `parent_comment_id` | uuid FK null | threading |
| `mentions` | uuid[] | @mentioned user ids → triggers notification |
| `created_at` / `edited_at` | timestamptz | |

### `attachments`

| Column | Type | Notes |
|---|---|---|
| `id` uuid PK, `task_id` uuid FK, `comment_id` uuid FK null, `uploaded_by_id` uuid FK, `file_url` text, `file_name` text, `mime_type` text, `size_bytes` bigint, `created_at` timestamptz |

### ~~`time_logs`~~ — **REPLACED by `time_entries`**

> Superseded in Session 03 by the timer subsystem. `time_entries` and `time_extension_requests` are defined in [doc 17 §7](17-TASK-TIMERS-AND-TIME-LIMITS.md#7-data-model-additions), together with the timer columns added to `tasks`. There is **one** time table, not two. (Contradiction C-05.)

### `availability` (FR-014)
Leave, holidays, half-days.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `start_date` / `end_date` | date | |
| `type` | enum | `leave` \| `holiday` \| `half_day` \| `unavailable` |
| `capacity_multiplier` | numeric | 0 = fully out, 0.5 = half day |
| `note` | text null | |
| `approved_by_id` | uuid FK null | |

### `notifications`

| Column | Type | Notes |
|---|---|---|
| `id` uuid PK, `user_id` uuid FK, `type` enum, `title` text, `body` text, `link_to` text, `is_read` boolean, `created_at` timestamptz |

### `activity_log` / `audit_log` (FR-092, FR-093)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `actor_id` | uuid FK | who did it |
| `entity_type` | text | `task` \| `user` \| `project` \| `setting` |
| `entity_id` | uuid | |
| `action` | text | `created`, `status_changed`, `reassigned`, `deleted`, `capacity_override` |
| `before` / `after` | jsonb | the diff |
| `created_at` | timestamptz | |

---

## 2b. Security & identity tables — added Session 02 (doc 16)

### `auth_identities`
**Exists from Phase 1** so Google Sign-In (Phase 7a) can be added with no migration. One user may have several identities.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → users | |
| `provider` | enum | `password` \| `google` \| `microsoft` |
| `provider_subject` | text null | The provider's stable user id (`sub` claim) |
| `password_hash` | text null | **Argon2id.** Only for `provider = password`. |
| `is_temporary_password` | boolean | Forces a change at next login (doc 16 §3 Option B) |
| `temporary_expires_at` | timestamptz null | 24h |
| `last_password_change_at` | timestamptz null | |
| `password_history` | text[] | Last 5 hashes — reuse prevention |
| UNIQUE | (`provider`, `provider_subject`) | |

### `invitations`
Activation tokens. **The raw token is never stored — only its SHA-256 hash.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | the account being activated |
| `token_hash` | text | SHA-256 of a 256-bit random token |
| `created_by_id` | uuid FK | who provisioned the account |
| `expires_at` | timestamptz | +48h |
| `consumed_at` | timestamptz null | single use |
| `purpose` | enum | `activation` \| `password_reset` \| `email_change` |
| `sent_to_email` | text | |

### `mfa_factors`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `type` | enum | `totp` \| `webauthn` \| `recovery_codes` |
| `secret_encrypted` | text null | TOTP seed, encrypted at rest |
| `credential_id` / `public_key` | text null | WebAuthn / passkey |
| `friendly_name` | text | "Ahmed's iPhone", "YubiKey" |
| `is_primary` | boolean | |
| `verified_at` | timestamptz null | not active until verified |
| `last_used_at` | timestamptz null | |

### `recovery_codes`

| Column | Type |
|---|---|
| `id` uuid PK, `user_id` uuid FK, `code_hash` text, `used_at` timestamptz null, `created_at` timestamptz |

Ten per user, issued once, single use, shown only at generation.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `refresh_token_hash` | text | rotated on every use |
| `device_fingerprint` | text | session binding |
| `user_agent` / `ip_address` | text | |
| `ip_country` / `ip_asn` | text | change → forced re-auth |
| `created_at` / `last_seen_at` | timestamptz | |
| `expires_at` | timestamptz | role-scoped (doc 16 §4) |
| `absolute_expires_at` | timestamptz | hard cap |
| `revoked_at` / `revoked_reason` | | |
| `step_up_verified_at` | timestamptz null | recent re-auth for 🔒 actions |

### `login_attempts`
Feeds rate limiting, lockout, and anomaly detection.

| Column | Type |
|---|---|
| `id` uuid PK, `email_attempted` text, `user_id` uuid FK null, `ip_address` text, `ip_country` text, `user_agent` text, `outcome` enum (`success`\|`bad_password`\|`bad_mfa`\|`locked`\|`unknown_account`), `created_at` timestamptz |

### `security_events`
Distinct from `activity_log` — this is the security-specific stream that drives alerts.

| Column | Type | Notes |
|---|---|---|
| `id` uuid PK, `user_id` uuid FK null, `event_type` text, `severity` enum (`info`\|`warning`\|`critical`), `ip_address` text, `details` jsonb, `created_at` timestamptz |

Event types: `login_success`, `login_failed`, `account_locked`, `mfa_enrolled`, `mfa_disabled`, `password_changed`, `role_changed`, `new_device`, `new_country`, `impossible_travel`, `break_glass_used`, `step_up_failed`, `bulk_export`, `permanent_purge`.

### `break_glass`
The sealed recovery credential (doc 16 §6). **Pending Q-030.**

| Column | Type | Notes |
|---|---|---|
| `id` uuid PK, `credential_hash` text, `generated_at` timestamptz, `used_at` timestamptz null, `used_from_ip` text null, `invalidated_at` timestamptz null |

Only the hash is stored. The raw credential is displayed exactly once at setup and never again.

> **Immutability:** `activity_log`, `audit_log`, `security_events` and `login_attempts` have **no UPDATE and no DELETE grant for any role, including `super_admin`**. Append-only is what makes them trustworthy.

---

### `system_settings`
Single-row (or key/value) config, editable by Super Admin.

| Key | Default | Meaning |
|---|---|---|
| `soft_threshold_pct` | 85 | amber warning |
| `hard_threshold_pct` | 100 | requires override |
| `default_weekly_capacity` | **36** | points — ADR-004 |
| `default_max_concurrent` | 5 | tasks |
| `other_work_warning_pct` | 15 | Warn when "Other" work exceeds this share of capacity (Q-025) |
| `project_type_priority` | `client,event,business,self_promotion,other` | Rebalance shed order (Q-027) |
| `weight_project_familiarity` | 0.06 | Assignment factor S6 (FR-117) |
| `default_theme` | `system` | New-user theme default (FR-203) |

> ⚠️ Scoring weights were **rebalanced in Session 04** to total exactly 1.00 — skill 0.38, availability 0.28, deadline 0.14, fairness 0.09, performance 0.05, familiarity 0.06. The full canonical settings list is [doc 19 §5](19-MASTER-SPECIFICATION-REGISTRY.md#5-system-settings--the-complete-key-list).
| `workload_window` | `week` | rolling calculation window |
| `weight_skill` | 0.40 | scoring weight |
| `weight_availability` | 0.30 | scoring weight |
| `weight_deadline_fit` | 0.15 | scoring weight |
| `weight_fairness` | 0.10 | scoring weight |
| `weight_performance` | 0.05 | scoring weight |
| `team_timezone` | TBD (Q-010) | for overdue calculation |
| `digest_time` | 09:00 | daily digest send time |

---

## 3. Derived / computed values (not stored, calculated live)

| Value | Formula | Used by |
|---|---|---|
| `current_load_points` | Σ `effort_points × priority_weight` of a user's tasks where status category ∈ (`not_started`,`active`,`waiting`) and the task falls in the window | Workload view, assignment engine |
| `effective_capacity` | `weekly_capacity_points × availability_multiplier` for the window | Same |
| `utilisation_pct` | `current_load_points / effective_capacity × 100` | Colour coding, thresholds |
| `active_task_count` | count of tasks with status category = `active` | Secondary guard (FR-061) |
| `free_hours_before_due` | `effective_capacity` remaining between now and a task's due date | Deadline-fit score |
| `on_time_rate` | `completed_at <= due_date` ÷ total completed, last 90 days | Performance score, reports |
| `revision_rate` | count of *In Review → Revisions* ÷ tasks completed | Reports |
| `avg_cycle_time` | mean(`completed_at` − first *In Progress*) | Reports, estimate calibration |

> **Design note:** these are computed in a database view or a small service layer so the number is always consistent everywhere it appears. Never duplicated into a column that can go stale.

---

## 4. Indexes that matter

```
tasks(assignee_id, status_id)         -- workload calculation, hit constantly
tasks(due_date) WHERE is_deleted=false -- overdue scans, calendar
tasks(project_id)
tasks(reference)                       -- unique lookup
user_skills(skill_id)                  -- "who can do video editing?"
comments(task_id, created_at)
notifications(user_id, is_read)
activity_log(entity_type, entity_id, created_at)
```

---

## 5. Row-level security posture (NFR-006)

**Locked by ADR-003: members see only their own work.**

| Table | Rule |
|---|---|
| `tasks` | Member reads **only** rows where `assignee_id = self`. Coordinator/Admin/Super Admin read all. |
| `projects` | Member reads only projects where they have at least one task (BR-016). Coordinator/Admin/Super Admin read all. |
| `users` | Member reads their **own row in full**; for all other users, **name and avatar only** — no role, job title, skills, capacity, or workload. Admin+ reads all and writes non-Super-Admin rows. |
| `users` (super_admin rows) | **Writable only by the row's own identity.** Enforced additionally by a `BEFORE UPDATE OR DELETE` trigger (doc 03 §2). |
| `user_skills` | Member reads only their own. |
| `comments` / `attachments` | Readable only on tasks the reader can see. |
| `time_logs` | Member reads and writes only their own rows. |
| `availability` | Member reads and requests only their own; Admin+ approves. |
| `auth_identities` / `mfa_factors` / `recovery_codes` | Readable only by the owning user. `password_hash` is never selectable by any client-facing query. |
| `sessions` | User reads and revokes only their own. Super Admin reads all. |
| `activity_log`, `audit_log`, `security_events`, `login_attempts` | **Insert-only. No UPDATE or DELETE grant for any role, including `super_admin`.** Readable by Admin+ per doc 03. |
| `break_glass` | No client read path at all. Server-side verification only. |
| `system_settings` | Read by all authenticated users; write by Super Admin (some keys by Admin — doc 03 §3). |
| **Every table** | Additionally scoped by `organisation_id` from Phase 1 (Q-034, doc 16 §13). |
