# The Admin's manual

*Last checked against the running system on 2026-10-01.*

You see everything in the other three manuals, plus the controls that decide who
else does. This covers only the decisions that are yours alone — the ones that
look like settings but are really policy.

---

## 1 · Who can see the CRM at all

**This is the switch behind almost every "I can see nothing" question.**

The CRM is restricted to a named list — `crm_preview_members`. Today it holds
three people:

| | |
|---|---|
| sale manager tester | sales manager |
| Sarah | salesperson |
| Sahad | salesperson |

Anyone not on it — including the **Executive** — gets no Growth section in the
sidebar, and an empty desk if they reach it by URL. Farhan Shah is bounced to his
own dashboard.

Adding somebody is a decision, not a code change. Ask for it and it is one row.

---

## 2 · Which project has its own WhatsApp number

Today **only** *Demo — Product Enquiries [demo]* has one.

This decides more than it looks like it does:

- Whether **WhatsApp** on a lead opens *our* recorded thread or the
  salesperson's own handset — and a message from a handset records nothing
- Whether a stranger messaging that number becomes a lead at all
- Whether a new lead can be greeted automatically

⚠️ **Chitral Royal Homes — the real one, with 683 leads — has no number.** So
nothing built on WhatsApp reaches the project that matters most. That is a
settings change on the project, not code.

---

## 3 · What each project sells

Every project carries a `sells` setting — property or service — which drives
which qualification questions a lead is asked.

⚠️ **18 of 20 projects currently say "property", because that is the column's
default rather than anybody's decision.** Al Maida Frozen Food and AI & Digital
Division are both filed as property sellers. Worth a pass through them.

---

## 4 · Automatic attendance

**Attendance → Automatic attendance.** Two people are on it: you and Farhan
Shah. Each has a window, not a fixed time:

> In between **09:30–10:15**, out between **18:45–19:30** · Sunday off

A different minute inside those windows is chosen for each person each day, so
it reads like a person arriving rather than a machine firing. The switch turns it
on or off per person; only an Admin can.

A scheduled day is stamped `scheduled`, never `self`, so the attendance export
and the late count can always tell the two apart. It stands down on a day off and
on approved leave, and never overwrites a check-in somebody made themselves.

⚠️ **The two office teams do not share a weekend.** Blue Area (Islamabad) works
Monday–Saturday and rests Sunday; Wah works Monday–Thursday and Saturday–Sunday,
and rests **Friday**. Anything that assumes "Sunday off" is wrong for eight
people.

---

## 5 · Roles, and what each costs you

| Role | Gets |
|---|---|
| **Super Admin** | everything, and cannot be edited by anybody else |
| **Admin** | everything operational, including this list |
| **Executive** | runs the work, sees the business, no Vault — see [`03-EXECUTIVE.md`](03-EXECUTIVE.md) |
| **Team Coordinator** | runs the digital team; does not read leads |
| **Member** | their own work; the CRM only if on the preview list |

Separately, inside a department, somebody is a **manager**, **salesperson**,
**member**, **marketing** or **support**. That is what decides whether they see
the whole desk or only their own leads — *not* the role above.

⚠️ **So "sale manager tester" is a `member` who is a department `manager`.** Both
words matter, and they are set in different places.

---

## 6 · The things only you should change

- Adding somebody to the CRM preview list
- Giving a project a WhatsApp number
- What a project sells
- Switching automatic attendance on for somebody
- Creating an Executive
- The Vault

---

## Not built yet, across the whole CRM

| | |
|---|---|
| **Merging duplicate leads** | 30 phone numbers have more than one lead. Detection works, merging does not exist. **Next.** |
| **Tags, branch, territory** | none of the three |
| **Custom fields** | no definitions; only Meta's own answers are stored |
| **Contacts as records** | a lead *is* the person; one human enquiring twice is two rows |
| **Campaign on a lead** | the table is empty — Meta returns it blank because the page and the ad account are in different portfolios. One permission change at Meta. |
| **Google Ads, TikTok** | listed as *coming soon*, not connected |
| **Property share as PDF** | written but not wired to the Share dialog |
| **Public customer share-link** | drawn in your reference, not built |

---

## Try this in fifteen minutes

1. **Attendance** — does the panel say *In between 09:30–10:15* for both people,
   rather than a single time?
2. Pick a day last week. Late arrivals and unclosed days are **real** — 64 late
   arrivals and 40 days nobody closed, in September alone. They are the record
   as people made it, and nothing has been tidied.
3. **Growth → Campaign & Lead Desk** — can you see every project in the picker,
   including the ones marked *not connected*?
4. **Lead reports** → *Which app the leads came from* on Chitral Royal Homes.
   Does it split Facebook from Instagram and say how many it could not split?
5. Sign in as Sarah (or ask her). Does she see only her own leads, no **Share
   out**, and no **Website form** button?

That last one is the check that matters most — it is the difference between the
screen hiding something and the database refusing it. Both are in place; step 5
proves the visible half.
