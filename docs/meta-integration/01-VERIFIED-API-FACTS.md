# 🔬 VERIFIED API FACTS — v26.0, tested 2026-09-04

> **Everything on this page was run against the live Graph API with the real
> token, not read from documentation.** Where a metric is listed as working, it
> returned a number. Where it is listed as dead, Meta refused it by name.
>
> ⚠️ **Do not re-derive this by trial and error.** It cost a full reconnaissance
> pass. If a metric stops working, add a line to §6 rather than rewriting.

---

## 1 · Why this file exists

The earlier plan (`docs/META-INTEGRATION-PLAN.md` §3) warned that Meta renames and
retires metrics, and that every name should be treated as a candidate until
tested. **That warning was correct.** Four of the metric names a reasonable
engineer would reach for are dead in v26.0, and the failures are silent-ish —
they come back as `(#100) The value must be a valid insights metric`, which reads
like a typo rather than a deprecation.

---

## 2 · Facebook Page — `/{page-id}/insights`

**Requires a PAGE access token.** With the system user token every one of these
returns `(#190) This method must be called with a Page Access Token`.

```
GET /{page-id}?fields=access_token      → the page token
GET /{page-id}/insights?metric=…&period=day&since=…&until=…
```

### ✅ Working

| Metric | Last value seen | Meaning |
|---|---|---|
| `page_follows` | 20 | **Total followers.** The growth number |
| `page_post_engagements` | 16 | Engagement actions |
| `page_views_total` | 30 | Page views |
| `page_daily_follows_unique` | 0 | New follows that day |
| `page_video_views` | 28 | Video views |

### ❌ Dead in v26.0 — `(#100) The value must be a valid insights metric`

`page_impressions` · `page_impressions_unique` · `page_fans` · `page_fan_adds`

⚠️ **`page_impressions` and `page_fans` are the two most commonly cited Facebook
metrics in every tutorial online, and both are gone.** `page_follows` replaces
`page_fans`. **No working Facebook reach metric was found** — see §6.

---

## 3 · Instagram — `/{ig-user-id}/insights`

**Uses the system user token directly.** No page token needed.

### ✅ Working with `period=day` only

| Metric | Notes |
|---|---|
| `reach` | Returns a daily series. The main Instagram reach number |
| `follower_count` | Returned **0 values** on this account — see §5 |

### ✅ Working, but ONLY with `metric_type=total_value`

⚠️ **This is the trap.** Without the parameter each returns
`(#100) The following metrics (…) should be specified with parameter
metric_type=total_value`. The result shape is different too — the number is at
`data[0].total_value.value`, not in a `values[]` array.

| Metric | Value over 10 days |
|---|---|
| `views` | 24 232 |
| `profile_views` | 143 |
| `accounts_engaged` | 53 |
| `total_interactions` | 142 |
| `likes` | 97 |
| `comments` | 3 |
| `shares` | 18 |
| `saves` | 5 |
| `replies` | 0 |
| `website_clicks` | 0 |
| `profile_links_taps` | 0 |

### ❌ Dead

`impressions` — Meta's own error names the replacements:
*"metric[0] must be one of the following values: reach, follower_count,
website_click"*. Use `views` instead.

---

## 4 · Posts

### Instagram — `/{ig-user-id}/media`

Fields confirmed present: `id`, `caption`, `media_type`, `media_product_type`,
`permalink`, `timestamp`, `like_count`, `comments_count`, `thumbnail_url`,
`media_url`.

Per-post insights via `/{media-id}/insights`, all confirmed working:
`reach` · `likes` · `comments` · `saved` · `shares` · `total_interactions` · `views`

### Facebook — `/{page-id}/posts` (page token)

Confirmed: `id`, `message`, `created_time`, `permalink_url`, `full_picture`,
`shares`, and counts via `likes.summary(true).limit(0)` /
`comments.summary(true).limit(0)`.

⚠️ **`permalink_url` and `thumbnail_url` both come back populated**, which means
the owner's *"if I want to see some post, I will just click it and it will bring
me to that post"* needs no extra work — and no URL-matching guesswork. **This
kills the hardest problem in the original plan** (`META-INTEGRATION-PLAN.md`
§5.5), which assumed we would have to match a pasted URL back to a Meta post ID.
We pull posts *from* Meta, so the ID and the link arrive together.

---

## 5 · ⚠️ Limits that shape the design

### The 30-day request window is a hard cap

```
since=2026-07-06&until=2026-09-04
→ (#100) There cannot be more than 30 days (2592000 s) between since and until
```

Older 30-day windows **are** accepted without error, but returned **0 days with
data** on this account. So: page backwards in ≤30-day windows, and expect roughly
a month of usable history at most.

**This confirms the build order.** The snapshot job must run before any UI,
because history that is not captured cannot be recovered later. Owner has
accepted this: *"the 30 days of data are present in a matter so I will fetch all
of them and put them in my database."*

### Demographics need 100 followers

`follower_demographics` returns **`{"data": []}` — empty, not an error** — on an
account with 16 followers. Meta's privacy floor.

⚠️ **This directly affects two panels the owner asked for from the screenshots:
"Top Locations" and "Age & Gender". They cannot be populated for the current
account.** Decision needed — see `00-STATE-AND-TRACKER.md` §7 question 2.

### `follower_count` returned nothing

Zero values for the 10-day window. Likely the same privacy floor, or no follow
events on a 16-follower account.

⚠️ **Do not rely on it.** Use the profile field `followers_count` from
`/{ig-user-id}?fields=followers_count` and snapshot it ourselves each run. That
is a current total we can always read, and once stored daily it becomes the
history Meta will not give us.

---

## 6 · Open API questions

| Question | Status |
|---|---|
| Is there a working Facebook **reach** metric in v26.0? | **Unresolved.** `page_impressions*` are dead. Candidates to try: `page_impressions_organic_v2`, or derive reach from post-level data. Fall back to `page_views_total` + `page_post_engagements` and label them accurately rather than showing a wrong "reach" |
| Do metrics behave differently on a page with real volume? | Unknown — this account is tiny (20 followers). Re-verify against the first real client page |
| Is App Review needed for client pages? | Unknown. The token works on the business's **own** page today. Client pages must be shared into the Business account first |

---

## 7 · Reproducing any of this

```bash
set -a && . ./.env.local && set +a
export PYTHONIOENCODING=utf-8          # captions contain emoji; Windows cp1252 crashes without it

V=$META_API_VERSION                    # v26.0
IG=17841439385217280
PAGE=1183663484837998

# Instagram — system user token works directly
curl -s -G "https://graph.facebook.com/$V/$IG/insights" \
  --data-urlencode "access_token=$META_SYSTEM_USER_TOKEN" \
  --data-urlencode "metric=views" --data-urlencode "metric_type=total_value" \
  --data-urlencode "period=day" --data-urlencode "since=2026-08-25" --data-urlencode "until=2026-09-04"

# Facebook — must derive a page token first
PT=$(curl -s -G "https://graph.facebook.com/$V/$PAGE" \
     --data-urlencode "access_token=$META_SYSTEM_USER_TOKEN" \
     --data-urlencode "fields=access_token" | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -G "https://graph.facebook.com/$V/$PAGE/insights" \
  --data-urlencode "access_token=$PT" --data-urlencode "metric=page_follows" \
  --data-urlencode "period=day" --data-urlencode "since=2026-08-25" --data-urlencode "until=2026-09-04"
```

⚠️ Always `--data-urlencode`. Putting the token in the URL string leaks it into
shell history and breaks on special characters.
