# 📊 META INTEGRATION — Trend & Engagement Studio

Pulling Facebook and Instagram performance into Taskly, so growth sits beside the
work that produced it.

**Branch:** `meta-integration` · **Never `main`** · **Nothing deployed**

---

## Read in this order

| File | What it is | When to read |
|---|---|---|
| **[`00-STATE-AND-TRACKER.md`](00-STATE-AND-TRACKER.md)** | ⭐ **Start here.** What is done, what is next, the hard rules, the session log | **Always, first** |
| [`01-VERIFIED-API-FACTS.md`](01-VERIFIED-API-FACTS.md) | What the Graph API actually returned when tested — working metrics, dead metrics, limits | Before writing any API code |
| [`02-DATA-MODEL.md`](02-DATA-MODEL.md) | The five proposed tables and why each is shaped that way | Before writing migrations |
| [`03-UI-SPEC.md`](03-UI-SPEC.md) | The Studio page, its tabs and its panels | Before writing UI |
| [`04-PHASES.md`](04-PHASES.md) | Build order, exit criteria, and the open questions | When picking up work |

The earlier, superseded high-level plan is
[`../META-INTEGRATION-PLAN.md`](../META-INTEGRATION-PLAN.md). ⚠️ Parts of it are
now **wrong** — it assumed token refresh (the system user token never expires)
and assumed post-URL matching would be hard (posts come from Meta with their
permalinks). Prefer this folder.

---

## In one paragraph

Taskly knows what was promised and what was posted. It has never known whether
any of it worked. A cron pulls daily figures and posts from Meta into Taskly's
own tables; a new page — **Trend & Engagement Studio**, at `/studio` — reads
those tables and draws the answer. It never calls Meta at page load, so Meta
being slow makes the page *stale*, never broken.

---

## The three things most likely to trip up a new session

1. **Facebook needs a Page access token; Instagram does not.** Instagram uses the
   system user token directly. Facebook Page insights refuse it with `(#190)` and
   need a token derived per page.
2. **Several obvious Facebook metrics are dead in v26.0** — `page_impressions`,
   `page_fans` and two others. They fail with `(#100)`, which reads like a typo
   and is not.
3. **Most Instagram metrics need `metric_type=total_value`**, and the result then
   sits at `data[0].total_value.value` rather than in `values[]`.

All three are documented with reproductions in `01-VERIFIED-API-FACTS.md`.
