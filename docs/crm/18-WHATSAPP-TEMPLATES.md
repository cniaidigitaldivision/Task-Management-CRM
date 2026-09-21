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
| To create now | **13** — 12 usable immediately, `payment_received` waiting on its trigger |
| Not needed as templates | demo booking and reminder (appointments), the negotiation itself (ordinary messages) |
