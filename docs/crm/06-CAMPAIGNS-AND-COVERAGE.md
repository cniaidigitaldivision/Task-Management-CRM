# Campaigns, ad accounts and coverage

Verified live **2026-09-09**. This is the file that answers "which campaign
produced this lead", and it turned up something that changes the data model.

---

## The finding

**One ad account runs lead campaigns for many different client projects, across
many different Facebook pages.**

`act_1383869210625183` — "CNI ad account", reachable with the **CNI** token —
holds 6 ACTIVE `OUTCOME_LEADS` campaigns and 8 live lead ads:

| Campaign | Page it posts to | Taskly project | Page linked to Taskly? |
|---|---|---|---|
| chitral royal homes campaign | 543363052190733 | Chitral Royal Homes | ✅ yes |
| Female model Hiring campaign of attari gourp page | 101265874755900 | Attari Group – AGC | ✅ yes |
| CNI_KSA_LeadGen_RYD-JED_Sep26 | 862439430295746 | Crescent Nova International | ✅ yes |
| The Executive housing Project campaign | 302982680199394 | The Executive Housing Project | ❌ **no** |
| AGC Construction & Leads campaign | 1145446828660442 | AGC Construction & Interior Design | ❌ **no** |
| investo 21 campaign for Etemaad 100 | 107426385582365 | Investo 21 / ETEMAAD100 | ❌ **no** |

The other ad account, `act_1577623389440030` (Chitral token, PKR), holds 25
campaigns — all PAUSED, and all engagement/page-likes/messages rather than lead
generation. It is history, not a lead source.

`act_4406620362934106` ("Chitral Royal homes AD account", USD) has **0**
campaigns.

---

## ⚠️ Three campaigns are producing leads we cannot read

Pages `302982680199394`, `1145446828660442` and `107426385582365` are **not in any
business portfolio the Taskly system user can reach**. `me/accounts` returns them
for no token we hold.

So: The Executive Housing, AGC Construction and Investo 21 are running live lead
campaigns, and their leads are invisible to this CRM.

**The fix is in Meta, not in code.** For each of those three pages, in Business
Suite: assign the page to a portfolio the Taskly-App system user belongs to, and
give that system user Full access to the page. The same step that was done for
Chitral, AGC and CNI.

Until then those leads accumulate where we cannot see them — and the 90-day
deletion clock is running on them too.

---

## ⚠️ Why `campaign_name` comes back empty on a lead

Requesting `campaign_id,campaign_name,adset_name,ad_name` on the `/leads` edge
returns **no error and no values**. `platform` and `is_organic` come back fine,
so the request itself is accepted.

The reason: Meta only fills those ad fields when the caller has `ads_management`
on **the ad account that ran the ad**, as well as access to the page. Here the
page (Chitral) is in one portfolio and the ad account that ran its campaign is in
another. The Chitral token has the page but not that ad account; the CNI token
has the ad account but not that page. Neither has both, so neither gets the join.

### Two ways to fix it

**(a) In Meta — the clean fix.** Assign `act_1383869210625183` to the same system
user that holds the pages, or add the pages to the portfolio that holds the ad
account. Then `campaign_name` arrives on the lead directly, with no extra calls
and no mapping to maintain.

**(b) In code — the fallback.** Build a `form_id → campaign` map from the ad
account side (`/{ad-account}/ads?fields=campaign{name},creative{object_story_spec}`)
and join on it at import. Works without touching Meta, but it is a second source
of truth that goes stale whenever an ad is edited.

**Recommendation: (a), and (b) only if (a) is refused.** One permission change
removes a whole subsystem.

---

## What this means for the data model

The owner asked for a **campaign column** and for the CRM to be filtered by
project, like the Studio.

⚠️ **"One ad account = one project" is wrong here**, and it was the obvious
assumption. One ad account serves six projects. So the mapping to a Taskly
project has to hang off something narrower:

| Option | Verdict |
|---|---|
| Ad account → project | ❌ Wrong. One account, six projects. |
| **Page → project** | ✅ Works today. We already store the page per project in `meta_accounts`. |
| **Campaign → project** | ✅ Most precise, and the campaign names already read like project names. |
| Form → project | ✅ Also works, but forms are named "…-copy-copy-copy" and are harder for a person to map. |

**Recommendation: page → project as the automatic default** (we already have that
link in `meta_accounts`), with **campaign → project as an override** for the case
where one page runs campaigns for two projects. Both are one small table.

---

## Where the campaign names already tell the truth

Worth noticing: the campaigns are named after the projects — "chitral royal homes
campaign", "The Executive housing Project campaign", "investo 21 campaign for
Etemaad 100". Whoever set them up was consistent.

That makes the first mapping cheap: show the six campaigns, let the owner pick a
project for each, store it once. It never needs doing again unless a new campaign
launches, and a new campaign is exactly when somebody should be asked.
