# Running the desk — the sales manager's manual

*Last checked against the running system on 2026-10-01.*

You can do everything in [`01-SALESPERSON.md`](01-SALESPERSON.md), and that
manual is worth reading first — it is what your team sees. This one covers the
six things only you can do.

---

## 1 · The queue nobody owns

**Growth → Campaign & Lead Desk.** You see every lead on your department's
projects, not just your own.

Above the table, when there is anything to share:

> **312 leads have nobody working them.** Sharing out gives each to whoever holds
> the fewest open leads, and on a tie to whoever has waited longest — oldest
> enquiry first.

Set a number, press **Share out**. Each lead is given one at a time, so the
counts update as it goes and the load genuinely balances.

### ⚠️ Strangers are held back, deliberately

When somebody messages the WhatsApp number who is not already a lead, they are
**not** given to a salesperson. They wait for you, marked **"Messaged us"** on
the row, and the strip says so:

> *2 people messaged the WhatsApp number themselves and are waiting for you to
> read them. Sharing out never hands a stranger to a salesperson.*

**Show them** filters to exactly those. Press **Share out** and they stay put —
that is the intended behaviour, not a fault.

Open one and you have two choices:

- **Owner** → pick a salesperson. It is theirs from that moment.
- **Mark as spam** → asks you to confirm, then archives the lead **and blocks the
  number**. Their future messages reach nobody. Only a manager can undo it.

---

## 2 · Who is carrying what

**The sales team** panel at the bottom of the desk: open leads, won, usual reply
time, when each person last got a lead. This is what the rota reads when it
decides who gets the next one.

A manager is listed as *"Manager — not in the rota"*. You are not given leads
automatically.

---

## 3 · Connecting a website form

**Campaign & Lead Desk → Website form.**

This is how a client's own contact page files leads straight into the desk, with
no copying and pasting.

1. Pick the project the leads should arrive on
2. Give the key a label — *"Chitral landing page"* — and press **Issue**
3. **Copy the key now.** Only a fingerprint is stored, so it genuinely cannot be
   shown again. Issuing another costs nothing.
4. Copy the **form snippet** and send it to whoever maintains the website. It is
   plain HTML with the key already in it.

The list underneath shows each key with **"4 filed, 0 refused"**. Both numbers
matter: a key quietly refusing everything is a form that has stopped working,
and the refused count is where you see it.

**Withdraw** stops a key immediately without deleting the leads it filed.

The snippet carries a hidden field that is a trap for bots. Leave it in.

---

## 4 · Importing a list, and splitting it

**Import**, same four steps your team sees — with one extra on the Review step:

> **Who works these leads?** Pick nobody and they all stay with you. Pick one or
> more and they are shared out between exactly those people.

Pick two people and the rota splits the list between **only those two**, by
workload. It is not an even split and the panel says so: if one of them is eight
leads lighter, most of the batch goes to them. That is the rota working, not a
fault.

---

## 5 · The numbers

Two screens only you and an Admin can open:

- **Live overview** — what is happening now
- **Lead reports** — five reports, computed once and kept, so a figure you quoted
  in September still reads the same in December:

| | |
|---|---|
| Lead funnel | where everyone is |
| How long leads have been waiting | the ageing buckets |
| Where the leads came from | grouped by **form** |
| **Which app the leads came from** | grouped by **channel** — Facebook vs Instagram |
| How the team is doing | per person |

The last two answer different questions. One form runs on both Facebook and
Instagram, so "which form pulls" and "which app pulls" are not the same.

⚠️ The channel report names what it cannot split: leads imported before
15 September 2026 are filed as **Meta** because Meta did not say which app the
ad ran on, and that cannot be recovered. The report says so rather than quietly
folding them into Facebook.

Every report downloads as CSV.

---

## 6 · What even you cannot do

| | |
|---|---|
| See another department's leads | an Admin |
| Add somebody to the CRM | an Admin — the preview list |
| Give a project its own WhatsApp number | an Admin |
| Change what the rota weighs | a code change |

---

## Not built yet

- **Merging two leads.** There are 30 phone numbers in the system with more than
  one lead against them. Detection works; merging does not exist. Being built
  next.
- **Tags, branch, territory.**
- **Campaign** is empty on every lead — Meta returns it blank because the page
  and the ad account sit in different portfolios. One permission change at Meta
  fills it in.
- **Google Ads and TikTok** are listed as *coming soon* and are not connected.

---

## Try this in twenty minutes

1. Open the desk. Is there an **Unassigned (n)** entry in the owner filter? Pick
   it — do you get exactly those rows?
2. If any row says **"Messaged us"**, open it. Can you set an **Owner**? Is
   **Mark as spam** offered?
3. Press **Share out** with a stranger in the queue. The ordinary leads should
   move and the stranger should stay.
4. **Website form** → issue a key → copy the snippet. Paste it into any HTML file
   and submit it. Does the lead appear on the desk within a few seconds, owned by
   somebody?
5. **Import** a small sheet. On Review, pick two salespeople. After importing,
   check both have some.
6. **Lead reports** → *Which app the leads came from* → Generate. Does it split
   Facebook from Instagram, and say how many it could not split?

Report anything that differs, with the step number.
