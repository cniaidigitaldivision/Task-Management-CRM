# Feature map

Three sources: what the owner named, what the two reference CRMs do, and what
the market treats as standard in 2026. Sorted by whether a feature earns its
place, not by how impressive it sounds.

---

## A · What the owner named, 2026-09-09

Verbatim, so nothing is lost in paraphrase:

1. Lead capture from the API
2. Lead assignment to a specific staff member
3. Call & voice system — *"not working right now, I will work on it"*
4. Auto follow-ups — *"this should be a very advanced follow-up"*
5. Email integrated, with proper templates
6. WhatsApp integration
7. Contact management
8. CRM reports
9. Smart dashboard — *"I will put AI intelligence over there"*
10. Notes per lead — *"he should properly note what quotation I have given him"*
11. Three roles: admin/super-admin dashboard **and** staff dashboard
12. Project dropdown, like the Studio — the CRM scoped to one project at a time
13. Filters on the staff view

Explicitly deferred by the owner: the tick/Go sync icons, the click-to-call from
mobile, and the AI report icon. *"That will also come soon. I'm not working on it
right now."*

---

## B · What the PropForce screenshot actually shows

Read off the image rather than guessed. One row of their list is:

```
Follow Up · Jul 29 2026 3:15 pm | Call – Call Attempt · 7 days ago |
Zain Ul Abedin (BDM-I · Islamabad) | 🔥 | 3120302 · Dec 06 2021 |
Khurram · 16 Leads | Tomorrow Land Country Club & Resorts · Sell › Primary |
[GO] [WhatsApp] [Email] [✓] [doc]
```

Which decomposes into the columns a working list needs:

| Element | What it is |
|---|---|
| Follow Up + timestamp | The **next action** and when it is due — the row is sorted on this |
| Call – Call Attempt / Contacted Client | The **outcome of the last call**, and how long ago |
| Zain Ul Abedin, BDM-I, Islamabad | **Owner**, their role, their branch |
| 🔥 | **Temperature** — hot / warm / cold |
| 3120302 · Dec 06 2021 | **Client reference and when they first came in** |
| Khurram · 16 Leads | **Client name**, and how many leads that person has |
| Tomorrow Land… · Sell › Primary | **Project**, and the deal type |
| GO / WhatsApp / Email / ✓ / doc | **Per-row actions** |

The lesson worth stealing: **the row is built around the next action, not around
the lead's name.** A staff member opens this to answer "who am I calling next",
and the list is sorted by that. Most CRM lists are sorted by created date and are
useless for the job.

Their left rail — Clients, Leads, Todos, Tasks, Pipeline, Sales Dispute, Call
Recordings — is a staff person's day. Their top nav — Dashboard, Clients & Leads,
Projects & Inventory, Staff, Management, Reports, Accounts, Policies, Workflows —
is the company's.

---

## C · What the market treats as standard (2026 research)

From the sources listed at the foot of this file.

**Table stakes — a CRM without these is not competitive**

- Lead capture from ads, website, portals — deduplicated, with the source recorded
- Automatic assignment by rule: geography, price band, product, availability
- Follow-up sequences that **pause the moment the lead replies**
- Pipeline stages with reminders and scheduled appointments
- Activity timeline per lead — every call, message and note in one place
- Reports: source → conversion, per-staff performance, ageing

**Differentiators in 2026**

- **Predictive lead scoring** from historical conversion, not hand-set weights
- **Call transcription and summarisation** — objections, next steps, buying signals
- **Sentiment** on conversations
- **Next-best-action** suggestions
- **AI qualification agents** on WhatsApp — ask adaptive questions, score, book

**Speed is itself a feature.** Webhook delivery is under 5 seconds; polling is
1–15 minutes typical, and up to 30. Contact and conversion rates fall sharply
with response time. This is the strongest argument for doing webhooks properly
rather than a cron.

---

## D · The honest sort — what to build, in what order

### Tier 1 — without these there is no CRM

| Feature | Why first | Depends on |
|---|---|---|
| **Lead import from Meta** | 615 leads are expiring. Nothing else matters if the data is gone. | Verified ✓ |
| **Lead table + RLS** | Where they land, and who may read them | Owner decision on visibility |
| **Project ↔ lead link** | The owner works project-by-project, like the Studio | Owner decision on mapping |
| **Assignment to a staff member** | The owner's #2, and what makes the staff view possible | Roles decision |
| **Stages + next action + due date** | The row's organising idea. Without it the list is a spreadsheet. | Owner decision on stages |
| **Notes per lead** | The owner asked for it by name and gave the reason: people forget what they quoted | — |
| **Two views: admin (all, by project) and staff (mine)** | Explicitly requested | Roles decision |

### Tier 2 — makes it a working desk rather than a list

| Feature | Note |
|---|---|
| Call outcome logging | Log the outcome by hand first. It is 90% of the value of a call system and needs no provider. |
| WhatsApp **link-out** per row | `wa.me/{phone}` opens the chat. No API, no approval, works today. |
| Email send with templates | Taskly already sends email; this is templates + logging, not new plumbing. |
| Follow-up reminders | Due-date driven, surfaced on the staff dashboard. |
| Duplicate detection on phone | The same person fills two forms. Merge or flag before it becomes a data problem. |
| Reports: source, staff, ageing, conversion | Reuse the existing report writers — CSV/XLSX/PDF already exist. |

### Tier 3 — real value, but only once Tier 1 has real data in it

| Feature | Honest caveat |
|---|---|
| Webhook capture (real-time) | Needs App Review + public callback. Do polling first; it is the reconciliation you need anyway, because **webhooks fail silently**. |
| Lead scoring | Needs conversion history. Scoring with no outcomes is a random number with a percentage sign. |
| WhatsApp Business API sending | Needs the API number and template approval. |
| Call & voice system | Needs a provider decision. Owner has deferred it. |
| AI summaries / next-best-action | Needs conversation data to summarise. Build the logging first. |

### Tier 4 — named by the reference CRMs, probably not for this division

Listed so the decision is explicit rather than forgotten: Projects & Inventory
(unit-level stock), Sales Dispute, Accounts/commissions, Policies. These make
sense for a property brokerage with inventory. This division runs marketing for
clients — it does not hold the stock. **Recommend: skip unless the owner says
otherwise.**

---

## E · Where this plugs into what already exists

The point of building inside Taskly rather than beside it:

| Already built | The CRM uses it for |
|---|---|
| `projects` + the project dropdown pattern in the Studio | Scoping the whole CRM to one project |
| `users` + roles + `app.acting_at_least` | The three-role split, without inventing a permission system |
| Notification kinds + the bell + `/notifications` | "A lead was assigned to you", "a follow-up is due" |
| The report writers (CSV / XLSX / PDF) | CRM reports, for free |
| The email templates system | Follow-up emails |
| Meta suites + per-suite tokens + the vault | Capturing leads per business, already working |
| The task board's status machine | The pattern for lead stages — statuses people use because they are the words people say |

---

## Sources

- [The 9 best CRM Software for Real Estate Agents in 2026 — Zapier](https://zapier.com/blog/crm-for-real-estate/)
- [Real Estate CRM: The Complete Guide for Agents and Brokers (2026) — Sierra Interactive](https://www.sierrainteractive.com/insights/blog/real-estate-crm-guide/)
- [Real Estate CRM: The Complete Guide for Agents, Brokers, and Builders (2026) — Leadrat](https://leadrat.com/real-estate-crm-the-complete-guide-for-agents-brokers-and-builders-2026/)
- [Best AI-Powered CRM Software Benefits and Use Cases for 2026 — monday.com](https://monday.com/blog/crm-and-sales/crm-with-ai/)
- [The 6 Best Autonomous AI CRM Tools in 2026 — Zapier](https://zapier.com/blog/ai-crm/)
- [AI Lead Qualification Agent Guide 2026: Phone and WhatsApp — CallMissed](https://www.callmissed.com/blog/ai-lead-qualification-agent-guide-2026-phone)
- [Leads — Webhooks from Meta — Meta for Developers](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/)
- [Facebook Lead Ads API: Webhooks & Lead Retrieval Guide — LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/)
- [Meta Leads to CRM Sync Tools Compared (2026) — LeadSync](https://leadsync.me/blog/meta-leads-to-crm-sync-tools-compared/)
