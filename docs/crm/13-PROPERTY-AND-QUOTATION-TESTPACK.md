# 13 · The property and quotation test pack

**Status: RECORDED, NOT SEEDED. 2026-09-14.** The owner supplied this pack;
nothing from it has been written to the database, because Phase 5 of
`12-LIFECYCLE-SPEC.md` (properties and quotations) has not been built and there
is nowhere for it to go yet.

**This is the fixture Phase 5 will be built against.** When the schema lands,
this file is what the seed script reads from — not a fresh invention.

---

## ⚠️ The safety flags are requirements, not metadata

The owner shipped these alongside the data, and they are the most important part
of the pack:

```json
{ "is_test_data": true,
  "test_mode": true,
  "exclude_from_real_reports": true,
  "external_messaging_enabled": false,
  "allowed_test_recipients_only": true }
```

Read as engineering constraints rather than as a note:

| Flag | What it has to mean in the schema |
|---|---|
| `is_test_data` | A column on the row, not a naming convention. `[demo]` in a project name is a string somebody will eventually edit. |
| `exclude_from_real_reports` | ⚠️ `crm_reports` and `/lead-reports` must filter it out. A test quotation of PKR 4.5m inside a pipeline figure is how a board pack becomes wrong. |
| `external_messaging_enabled: false` | ⚠️ The send path must refuse a test row, in the **server action**, not by hiding a button. This is the flag that stops a test quotation reaching a real customer. |
| `allowed_test_recipients_only` | Only the owner's own numbers. The existing WhatsApp test number already enforces this at Meta's end; the application should not rely on that alone. |

And the instruction that goes with it, kept verbatim because it is a legal point
rather than a preference:

> *"Do not generate dummy NOCs, title documents or government approvals. Those
> could be mistaken for genuine legal documents. Use placeholders such as 'Legal
> document not uploaded'."*

⚠️ **This rules out a whole class of "helpful" seed content.** A generated NOC
with a plausible layout is a forged government document whatever the filename
says. The placeholder is the correct artefact.

---

## The arithmetic — checked, and it holds

Every figure in the pack was recomputed 2026-09-14 rather than accepted:

**Marla standard: 225 sqft**

| | Marla | Stated sqft | 225 × Marla | Dimensions | Product |
|---|---|---|---|---|---|
| PROP-A101 | 5 | 1,125 | 1,125 ✓ | 25 × 45 | 1,125 ✓ |
| PROP-B201 | 10 | 2,250 | 2,250 ✓ | 30 × 75 | 2,250 ✓ |

**PROP-A101 · PKR 4,500,000 · 18 instalments**

| Stage | % | Amount |
|---|---|---|
| Booking | 20 | 900,000 |
| Confirmation (30 days) | 10 | 450,000 |
| Instalments | 50 | 125,000 × 18 = 2,250,000 |
| Balloting | 10 | 450,000 |
| Possession | 10 | 450,000 |
| **Total** | **100** | **4,500,000 ✓** |

**PROP-B201 · PKR 8,200,000 · 20 instalments**

| Stage | % | Amount |
|---|---|---|
| Booking | 20 | 1,640,000 |
| Confirmation (30 days) | 10 | 820,000 |
| Instalments | 50 | 205,000 × 20 = 4,100,000 |
| Balloting | 10 | 820,000 |
| Possession | 10 | 820,000 |
| **Total** | **100** | **8,200,000 ✓** |

Both totals reconcile exactly and every instalment lands on whole rupees — which
is not luck, and is worth preserving: ⚠️ **a payment plan that needs rounding is
a payment plan that will be argued about.** If the generator ever produces a
fractional instalment it should refuse rather than round.

**QT-1043 after the requested PKR 200,000 discount** recomputes cleanly too —
8,000,000 gives 1,600,000 / 800,000 / 200,000 × 20 / 800,000 / 800,000. ⚠️ Which
is the point of the approval flow: **the plan is derived from the net price, so
approving a discount must regenerate the schedule, not just change a headline.**

---

## Four things in the pack that need a decision

### 1 · ⚠️ It names a project we do not have, and nearly names one we must not touch

The pack says **"Chitral Royal Homes — Demo Project"**. Our real client project
is **"Chitral Royal Homes"** (632 live leads), and our sandbox is **"Demo —
Product Enquiries [demo]"**.

Three options, and this needs the owner:

| | |
|---|---|
| **a** | Put the properties on the existing `Demo — Product Enquiries [demo]` project. Safest; the name on screen will not match the pack. |
| **b** | Create a new project literally named `Chitral Royal Homes — Demo Project`. Matches the pack exactly. ⚠️ Two entries beginning "Chitral Royal Homes" in every dropdown, one real and one not, is a mis-click waiting to happen. |
| **c** | Create it named `Chitral Royal Homes [demo]`, matching our existing `[demo]` convention, which the preview gate and the seed scripts already key off. |

**Recommended: (c).** It reads as the pack intends, and every existing safeguard
that looks for `[demo]` keeps working.

### 2 · ⚠️ One of the test phone numbers may reach a real person

| Lead | Number in the pack | |
|---|---|---|
| Faisal Rehman | +92 312 1533511 | one digit from the owner's own `+92 312 1531511` — worth a second look |
| Hina Shahzad | **+92 300 5551212** | ⚠️ `0300` is a live Jazz prefix and `5551212` is a valid subscriber number. **This can ring somebody.** |

The showcase seed already uses `+9230000000NN`, which is in no allocated range.
⚠️ **Test rows should keep unreachable numbers** — a demo that dials a stranger
is the failure mode that cannot be undone, and `external_messaging_enabled:
false` should not be the only thing standing in the way.

### 3 · The pack's earlier JSON and this one disagree on the booking amount

The lifecycle spec's JSON had `booking_amount: 450000` for QT-1042 (10%); this
pack has **900,000** (20%), which is what its own payment table computes. **This
pack wins** — it is later and internally consistent. Recorded so the discrepancy
is not rediscovered as a bug.

### 4 · The salesperson's name

The pack says **"Sarah Malik"**. The account was renamed to **"Sarah"** on the
owner's instruction the same day. Either extend the account's name or let the
seed write the pack's label — trivial, but it should be decided rather than
drifting.

---

## What this implies for the Phase 5 schema

The pack is specific enough to design against. Sketch only — nothing built:

**`crm_properties`** — project, property_id/code, plot number, block, type,
size_marla, area_sqft, dimensions, category, facing, road width, corner / park /
boulevard flags, base price, status (available · reserved · sold), development
status, expected possession, last price update, `is_test_data`.

⚠️ **`area_sqft` is stored, not computed on the fly, and the Marla standard sits
on the PROJECT** (`marla_sqft_standard: 225`) — the owner's own note says one
Marla varies by region, so a constant in code would be wrong the first time a
second project used a different one.

**`crm_payment_plans`** — per property or per quotation: ordered stages with a
label, a percentage, an amount, and a count for the instalment row. ⚠️ Stored as
rows, not as a blob: the quotation PDF, the approval recalculation and any future
receipt all need to read individual stages.

**`crm_quotations`** — number, **version**, lead, property, base price, premium
charges, requested discount, approved discount, net amount, valid_until, status
(draft · pending_approval · approved · expired · superseded), prepared_by,
approved_by, terms, PDF reference, `is_test_data`.

⚠️ **Number and version are separate columns with a unique pair.** "QT-1042 v2"
is a new row, never an edit — that is the single most important line in the
owner's §5, and the schema is where it gets enforced rather than remembered.

**The approval flow the pack describes** maps onto status transitions:
`pending_approval` blocks external send in the server action, notifies the
manager, shows amber; approval stores the discount, **recomputes the plan**,
writes version 2, flips to `approved`, and logs it.

---

## Documents: what to build, and what not to

The owner's own table, with the honest position on each:

| Document | Phase 5? |
|---|---|
| Property information sheet | ✅ generated from the record |
| Payment plan | ✅ generated from the stages |
| Quotation (PDF) | ✅ the main deliverable |
| Project brochure | ⚠️ upload, not generate — it is marketing copy, not data |
| Site plan / location map | ⚠️ upload |
| Site-visit form | Phase 7 |
| Booking application | Phase 7 |
| Payment receipt | after Phase 7, and it belongs with Finance |
| **Allotment / agreement / NOC / title** | ❌ **never generated here.** Placeholder only |
