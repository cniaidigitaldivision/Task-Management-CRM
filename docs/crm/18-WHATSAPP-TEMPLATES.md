# 18 · WhatsApp templates — the whole catalogue

> Owner, 2026-09-21: *"list out all the templates which are needed. I will go and
> add them all at once so next time this confusion will not happen."*

**This is the one list.** Every name here is pinned to its purpose by
`lib/domain/__tests__/crm-template-for-purpose.test.ts` ("the full catalogue").
Rename one and that test must change with it — a name that matches the wrong
purpose is a client receiving the wrong message.

---

## Four rules before creating any of them

**1 · A template is only a knock on a closed door.** Inside 24 hours of the
client's last message, anything can be sent as ordinary text — no template, no
approval. A template is needed only when the client has gone quiet. So a
negotiation that is *happening* needs no templates; one that has *stalled* needs
one to restart it.

**2 · Two blanks, always the same two.** `{{1}}` = the client's first name,
`{{2}}` = the business name. That is what the wizard fills (`TEMPLATE_FILL`,
migration 228). A template with a third blank cannot be sent from a follow-up and
is shown disabled — only a trigger that writes the values itself can send it
(the booking flow does this for the two appointment templates).

⚠️ **So amounts, dates and percentages do not go in a template.** "50% advance",
"delivered in three phases", "PKR 178,500" belong in the proposal or terms PDF,
or in a normal message once the client replies.

**3 · Templates belong to one WhatsApp number.** They are created on a WhatsApp
Business account and only that account can send them. Today only the demo
project has one. When Chitral Royal Homes gets its own number, this same set is
created again on *its* account — which is why `{{2}}` carries the business name
instead of it being typed into the text.

**4 · Meta decides the category, not us.** Anything about an existing
transaction (a booking, a payment, a confirmed deal) is usually **Utility**.
Anything that re-opens interest is usually **Marketing**, which costs more per
message on a real number and which Meta limits per person. Our greeting was
submitted as Utility and approved as Marketing.

**When Meta asks for sample values:** `{{1}}` = `Ayesha`, `{{2}}` = `CNI AI & Digital Division`.
**Language:** English (UK) for all of them.

---

## The master list — every template, what it does, where it stands

Checked against Meta on **2026-09-21**. The last column is for the move to the
real number: tick each one as it is approved there.

| # | Template name | What it does | Where the CRM uses it | Blanks | Test account | Real number |
|---|---|---|---|---|---|---|
| 1 | `lead_greeting_v2` | Welcomes a new lead the moment they arrive | Greeting — automatic on every new lead | 2 | ✅ Approved · Marketing | ☐ |
| 2 | `appointment_confirmed` | Confirms a booked visit, meeting, call or demo · Confirm / Change the time buttons | Booking an appointment — automatic | 5 | ✅ Approved · Utility | ☐ |
| 3 | `appointment_reminder` | Reminds the client before the appointment | Booking an appointment — automatic | 5 | ✅ Approved · Utility | ☐ |
| 4 | `quotation_follow_up` | Chases a quotation that got no answer | Follow-up purpose *Quotation* | 0 | ✅ Approved · Marketing | ☐ |
| 5 | `lead_check_in` | Nudges a lead who never replied | Follow-up purpose *No response* | 2 | ⏳ Pending | ☐ |
| 6 | `lead_details_request` | Asks for the business details a proposal needs | Follow-up purpose *Missing information* | 2 | ⏳ Pending | ☐ |
| 7 | `payment_reminder` | Reminds that a payment is due | Follow-up purpose *Payment reminder* | 2 | ⏳ Pending | ☐ |
| 8 | `after_visit_check_in` | Follows up after a visit, meeting or demo | Follow-up purpose *Site visit check-in* | 2 | ⏳ Pending | ☐ |
| 9 | `update_available` | Opens a shut window for any message at all | Chosen by hand — any follow-up | 2 | ☐ To create | ☐ |
| 10 | `lead_re_engage` | Revives a lead cold for weeks | Follow-up purpose *Re-engage* | 2 | ☐ To create | ☐ |
| 11 | `proposal_follow_up` | Chases a proposal that got no answer | Chosen by hand | 2 | ☐ To create | ☐ |
| 12 | `meeting_feedback` | Asks how a demo or visit went · rating buttons | Chosen by hand | 2 | ☐ To create | ☐ |
| 13 | `negotiation_follow_up` | Restarts a stalled negotiation | Chosen by hand | 2 | ☐ To create | ☐ |
| 14 | `agreement_ready` | Says the agreement is ready to review | Chosen by hand | 2 | ☐ To create | ☐ |
| 15 | `welcome_onboard` | Welcomes a client whose deal is won | Chosen by hand | 2 | ☐ To create | ☐ |
| 16 | `approved_offer` | Tells the client a revised offer was approved | Follow-up purpose *Approved offer* | 2 | ☐ To create | ☐ |
| 17 | `payment_received` | Confirms a payment was received, with the amount | ⚠️ A trigger on recording a payment — **not built yet** | 3 | ☐ To create | ☐ |
| — | `_lead_greeting` | Old greeting, replaced by #1 | Nothing | 3 | Approved, unused | **Do not recreate** |

⚠️ **Keep the names exactly.** #1, #2 and #3 are named inside the system itself
(the greeting plan and the booking flow), and #4–#16 are matched to their
purpose by name. A template called `lead_greeting` instead of `lead_greeting_v2`
on the real number would mean no new lead is ever greeted.

"Chosen by hand" means the follow-up wizard lists it, but no purpose picks it
automatically yet.

---

## Already approved

| Name | Blanks | What it is for |
|---|---|---|
| `lead_greeting_v2` | 2 | A new lead arrives |
| `appointment_confirmed` | 5 — booking flow | A visit, meeting, call or demo is booked · Confirm / Change the time buttons |
| `appointment_reminder` | 5 — booking flow | Before that appointment |
| `quotation_follow_up` | 0 | Chasing a quotation |
| `_lead_greeting` | 3 | ⚠️ Replaced by v2 — not used |

⚠️ **A demo needs no template of its own.** It is an appointment: book it as a
*Meeting* and the client reads *"your meeting with CNI AI & Digital Division is
confirmed for…"*. A *Demo* appointment type would make it read *"your demo…"* —
a small change, not a template.

---

## To create — the lead has not started talking

**`lead_check_in`** · purpose *no response* · likely Marketing
> Assalam-o-Alaikum {{1}}, this is {{2}} following up on your enquiry. Is there anything you would like to know, or a good time for a quick call? We are happy to help.

Quick replies (Custom): `Yes, let's talk` · `Not right now`

**`lead_details_request`** · purpose *missing information* · likely Marketing
> Assalam-o-Alaikum {{1}}, this is {{2}}. So we can prepare the right proposal for you, could you share a few details: what your business does, what you would like the software to handle, and roughly how many people will use it?

**`lead_re_engage`** · purpose *re-engage* — a lead cold for weeks · likely Marketing
> Assalam-o-Alaikum {{1}}, it has been a while since you contacted {{2}}. Are you still looking for a solution? If your plans have changed we completely understand — just let us know.

Quick replies (Custom): `Yes, still interested` · `Not anymore`

---

## To create — something has been sent and they went quiet

**`proposal_follow_up`** · for a proposal (services) · likely Marketing
> Assalam-o-Alaikum {{1}}, this is {{2}}. Did you get a chance to look at the proposal we shared? We would be glad to walk you through it or adjust anything to fit your requirements.

**`approved_offer`** · purpose *approved offer* — a revised price or plan was approved · likely Marketing
> Assalam-o-Alaikum {{1}}, good news from {{2}}: we have approved a revised offer for you. Reply to this message and we will share the details here.

---

## To create — negotiation

The negotiation itself happens in ordinary messages while the client is replying.
These three only restart it, or move it forward, when it stalls.

**`negotiation_follow_up`** · a stalled negotiation · likely Marketing
> Assalam-o-Alaikum {{1}}, this is {{2}} following up on the terms we discussed. If there is anything you would like to adjust, we are happy to go through it with you.

**`agreement_ready`** · terms agreed, documents ready · likely Utility
> Assalam-o-Alaikum {{1}}, the agreement from {{2}} is ready for your review. Please reply to this message and we will share it here, along with the next steps.

**`welcome_onboard`** · the deal is won · likely Utility
> Assalam-o-Alaikum {{1}}, welcome to {{2}}, and thank you for your trust. Our team will be in touch shortly to plan the next steps with you.

### What the terms document should say (not the template)

The AI agent reads documents, not templates — so a one-page **Commercial Terms**
PDF per product, uploaded to the project, is what lets it answer these questions
without a salesperson.

**For our own products (Taskly, CRM, ERP, WhatsApp Automation, any combination):**
payment schedule (e.g. 50% advance, the rest on delivery) · delivery in stages
(e.g. 50% in month one, 75% in month two, 100% in month three) · what is outside
the price and paid by the client (domain, hosting, Meta/WhatsApp conversation
charges, AI/API usage) · what counts as a change request and how it is priced ·
the support period after go-live and what it covers · training · who owns the
source code and data.

**For a real-estate client such as Chitral Royal Homes:** price per marla or
per unit · the payment plan (booking amount, down payment, monthly or quarterly
instalments, possession amount) · the discount for paying in full · extra charges
for corner, park-facing or main-boulevard plots · development and utility
charges · transfer and registration fees and who pays them · the possession date
· how long a plot is held after token money · the refund and cancellation policy.

---

## To create — after a visit, meeting or demo

**`after_visit_check_in`** · purpose *site visit check-in* · likely Marketing
> Assalam-o-Alaikum {{1}}, thank you for your time with {{2}}. We hope the meeting was useful. Do you have any questions, or shall we prepare the next step for you?

**`meeting_feedback`** · after a demo or a site visit — one template for both · likely Marketing
> Assalam-o-Alaikum {{1}}, thank you for meeting with {{2}}. How did you find it? Your feedback helps us serve you better.

Quick replies (Custom): `Very good` · `Good` · `Could be better`

---

## To create — payments

**`payment_reminder`** · purpose *payment reminder* · likely Utility
> Assalam-o-Alaikum {{1}}, this is a friendly reminder from {{2}} that a payment on your account is now due. If you have already paid, thank you, and please ignore this message. If you need the details again, just reply here.

**`payment_received`** · ⚠️ three blanks — sent by a trigger, not a follow-up · likely Utility
> Assalam-o-Alaikum {{1}}, thank you for your payment of {{2}} to {{3}}. It has been received and recorded on your account.

`{{2}}` = the amount, `{{3}}` = the business. ⚠️ Worded so the blanks appear in
order and the text does not end on one — Meta rejects a template that starts or
ends with a blank. **Not wired yet**: it needs a
trigger that sends it when a payment is recorded. Creating it now means it is
approved and waiting when that is built.

---

## To create — the one that covers everything else

**`update_available`** · any custom message when the window is shut · likely Utility
> Assalam-o-Alaikum {{1}}, there is an update for you from {{2}}. Please reply to this message and we will share the details here.

This is the answer to "a custom template". It says nothing specific, so it fits
any situation: the client replies, the window opens, and the real message goes
as ordinary text. Possession updates, project progress, documents ready — all of
them go through this one.

---

## Quick count

| | |
|---|---|
| Approved and in use | 4 |
| Submitted, waiting for Meta | 4 |
| Still to create | **9** — 8 usable once approved, `payment_received` waiting on its trigger |
| Not needed as templates | demo booking and reminder (appointments), the negotiation itself (ordinary messages) |
| **To create on the real number** | **17** — everything in the master table except `_lead_greeting` |

---

## Moving to the real number

**Yes — every template has to exist again.** Checked on 2026-09-21: all of the
above live on Meta's **"Test WhatsApp Business Account"** (`1747354729809810`),
the practice account that came with the +1 555 test number. A template belongs
to the WhatsApp Business *account*, not to the phone number, and the real number
will sit in a real account. Nothing carries over by itself.

Two ways to get them there:

- **Create them again** from this document. The master table is the checklist,
  and every wording here is copy-ready.
- **Ask me to copy them by API.** Meta can move templates between two accounts
  owned by the same business. Whether each one arrives already approved is
  something to check on the day. The table is the fallback either way.

⚠️ **One template to improve on the way.** `quotation_follow_up` has the
business name typed into its text and no blanks. On the real number, create it
with blanks under the same name:

> Assalam-o-Alaikum {{1}}, this is {{2}} following up on the quotation we shared with you. Did you get a chance to review it? We would be happy to explain the payment plan or arrange a meeting.

### The rest of the switch

Configuration only, no code (see `sandbox-first-then-real-number`): the
project's WhatsApp phone number id and business account id, the webhook
subscribed on the new account, a payment method on the new account, and the
display name approved by Meta. The business portfolio already shows as
**verified**, which the real number needs.

---

## What it costs on the real number

Checked 2026-09-21 against Meta's pricing documentation. **Prices change a few
times a year — check before relying on a figure.** Meta charges per message
*delivered*, in US dollars, by the country of the client's number. There is no
monthly fee for the API itself when using Meta directly, as this system does.

**Creating and submitting a template is free.** Only sending costs.

### Pakistan (+92) today

| Kind of message | Cost | Examples here |
|---|---|---|
| **Marketing template** | **$0.0473** each | greeting, check-in, re-engage, proposal / quotation / negotiation follow-ups, feedback |
| **Utility template** | **$0.01** each (was $0.0054 before 1 April 2026) | appointment confirmation and reminder, payment reminder, agreement ready, welcome |
| Utility template inside an open 24-hour window | free — **until 30 September 2026** | |
| Normal reply inside the 24-hour window | free — **until 30 September 2026** | a salesperson or the AI agent answering |
| Anything within 72 hours of a click on a Click-to-WhatsApp ad | free, and stays free | Click-to-WhatsApp ads only — not lead forms |

### ⚠️ From 1 October 2026

Normal replies inside the 24-hour window, and utility templates sent inside it,
start being charged at the utility rate (**$0.01** in Pakistan). Each phone
number gets **1,000 free every month**, with no carry-over. The 72-hour
Click-to-WhatsApp window stays free.

This matters for the AI agent: its replies are exactly these messages. The
first 1,000 a month cost nothing; after that, about a cent each.

### Rough monthly examples

At roughly PKR 280 to the dollar (check the day's rate):

| In a month | Cost |
|---|---|
| 100 new leads greeted + 50 chased once (Marketing) | 150 × $0.0473 ≈ **$7.10 · ≈ PKR 2,000** |
| 30 appointments, each confirmed + reminded (Utility) | 60 × $0.01 = **$0.60 · ≈ PKR 170** |
| 3,000 replies inside open windows, after 1 October | first 1,000 free, 2,000 × $0.01 = **$20 · ≈ PKR 5,600** |

### Three ways to keep it low

- **Get templates approved as Utility when they genuinely are.** Meta decides,
  and a template it files as Marketing costs almost five times as much.
- **Reply while the window is open.** A client who has just written can be
  answered as normal text instead of with a template.
- **Click-to-WhatsApp ads open 72 free hours.** A lead who starts the chat from
  such an ad costs nothing for three days; a lead from a form doesn't get this.

**Sources:** Meta for Developers, [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) ·
[YCloud — April 2026 rate update](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-april-1-2026) (Pakistan utility $0.0054 → $0.01) ·
[360dialog — service message charging from 1 October 2026](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/) (cites Meta's pricing documentation, updated 25 August 2026) ·
marketing rate $0.0473 as published on Meta's rate card and repeated by several providers, e.g. [Ominiflow — Pakistan](https://ominiflow.com/whatsapp-api-pricing/pakistan).
