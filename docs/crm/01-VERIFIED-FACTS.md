# Verified facts — proved against the live Meta API

Everything here was run against the real accounts on **2026-09-09** with the
division's own tokens. Nothing in this file is an assumption; where something is
still unknown it says so.

⚠️ **Re-verify before relying on any of it after ~2026-10-09.** Lead counts move
daily and Meta's 90-day retention silently removes rows.

---

## 1 · Ad accounts, per suite

Asked `me/adaccounts` with each system-user token.

| Suite | Ad accounts reachable |
|---|---|
| CNI AI & Digital Division | **0** |
| Chitral Royal Homes | 1 — `act_1577623389440030`, PKR, active |
| Crescent Nova International | 2 — `act_1383869210625183` "CNI ad account" (USD), `act_4406620362934106` "Chitral Royal homes AD account" (USD) |

### ⚠️ This corrects an assumption the owner stated

The owner said *"First of all we are working on AI and Digital because AI and
Digital are also running ads so their marketing API and ads API are connected."*

**AI & Digital Division's system user reaches no ad account and has no lead
forms.** Whatever ads that business runs are not visible to the token Taskly
holds. Either the ad account was never assigned to that system user, or the ads
run from a different portfolio.

The leads that exist are on **Chitral Royal Homes**. Building "AI & Digital
first" would mean building against an empty account.

---

## 2 · Lead forms and lead volume

Asked `{page-id}/leadgen_forms` with a **page** access token derived from each
system-user token. (With the system-user token directly it fails: `(#190) This
method must be called with a Page Access Token`.)

| Page | Forms | Leads |
|---|---|---|
| CNI Ai & Digital Division | 0 | 0 |
| **Chitral Royal Homes** | **6** | **615** |
| Jashn e Subhe Noor | 0 | 0 |
| Attari Group of Companies – AGC | 0 | 0 |
| Crescent Nova International | 3 | 0 |

Chitral's six forms, with the date of their most recent lead:

| Form | Status | Leads | Newest lead |
|---|---|---|---|
| Chitral Royal Homes-copy | ACTIVE | **553** | 2026-07-28 |
| CRH ( 17/08/26 ) | ACTIVE | 42 | 2026-08-26 |
| Chitral Royal Homes-copy-copy-copy | ACTIVE | **20** | **2026-09-09 — today** |
| Chitral Royal Homes-copy-copy | ACTIVE | 0 | — |
| Chitral Royal Homes | ACTIVE | 0 | — |
| Chitral Royal Homes-copy (v1) | ARCHIVED | 0 | — |

CNI's three forms — The Executive Housing, Town Square, Town Square 1 — exist
and have produced no leads yet.

**Leads are arriving today.** One form took a lead on 2026-09-09.

---

## 3 · Lead data is readable, and this is its shape

Read three leads from the 553-lead form. Confirmed working, with paging.

⚠️ No lead values are recorded in this document — they are a stranger's name and
phone number. Only the field *names* Meta returns:

```
country
which__size_are_you_interested_in?_
full_name
city
are_you_looking_for_plots_&_villa_?
phone_number
```
plus `id` and `created_time` on every lead, and `paging.next` for the rest.

### What this tells us about the data model

- **Field names are per-form and arbitrary.** `which__size_are_you_interested_in?_`
  is what the advertiser typed into Meta, punctuation and all. A schema with a
  fixed column per question will break on the next form.
  → Store the raw answers as JSON, and map the few that matter (name, phone) into
  real columns. See `03-DATA-MODEL.md`.
- **There is no email field on this form.** Any plan that assumes email as the
  follow-up channel is wrong for this client — phone and WhatsApp are what exist.
- **Meta gives no status, owner or stage.** Everything about working the lead is
  ours to store.

---

## 4 · The 90-day clock — the most urgent fact here

Meta retains lead data for **90 days** from submission, then deletes it. This is
Meta's policy, not a setting.

- Today is 2026-09-09.
- The 553-lead form's newest lead is 2026-07-28 — 43 days old.
- Its *oldest* leads are therefore materially older, and some may already be
  beyond retrieval.

**Consequence:** the first thing to build is the importer, not the interface. Every
week of design work is a week of the oldest leads disappearing. A one-off
backfill that stores what exists today costs little and stops the bleeding.

---

## 5 · Graph API version

`META_API_VERSION=v26.0` — current, and unaffected by the v20.0 shutdown on
2026-09-24 that older integration guides warn about.

---

## 6 · What is NOT yet verified

Honest gaps. Each needs a real call before it goes in a plan as fact.

| Unknown | Why it matters | How to settle it |
|---|---|---|
| Does the token have `leads_retrieval` **granted by App Review**, or is it working because the user is an admin of the asset? | Webhooks and production access need the reviewed permission. Working today does not prove it. | Check App Review status in the Meta app dashboard. |
| Can we register a **leadgen webhook**? | Decides real-time vs polling. | Requires app review + a public callback URL. |
| Which ad account belongs to which **project**? | A lead has to land on the right client's pipeline. | Owner decision — see `05-OPEN-QUESTIONS.md`. |
| Is there a **WhatsApp Business API** number available to Taskly? | Decides whether WhatsApp follow-up is a link or a real send. | Owner has a WhatsApp automation project; needs its credentials. |
| **Call system** — what provider? | Everything about call logging and recording depends on it. | Owner said this is later. |

---

## How to re-run these checks

The probes were ad-hoc Node scripts using `.env.local` tokens directly. To
repeat: read `META_API_VERSION` and the relevant `META_SYSTEM_USER_TOKEN*`, then

1. `GET /{version}/me/adaccounts?fields=id,account_id,name,account_status,currency`
2. `GET /{version}/me/accounts?fields=id,name,access_token`
3. `GET /{version}/{page-id}/leadgen_forms?fields=id,name,status,leads_count` — **page token**
4. `GET /{version}/{form-id}/leads?limit=3` — **page token**

⚠️ Step 4 returns personal data. Do not print values into a terminal or a
document; count them and read the field names only.
