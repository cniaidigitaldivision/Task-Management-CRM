# 🚪 ATTENDANCE TERMINAL — CONNECTED AND WORKING

> **Connected 2026-08-30 at 15:33 PKT.** The terminal in the Wah office is live
> and posting scans to Taskly over HTTPS. This file is the record of how it was
> set up and what was learned doing it.

Hikvision **DS-K1T320MFWX**, Wah office → `taskly.aidigitaldivision.com`.

---

## STATUS

| | |
|---|---|
| Terminal | **live** — serial `GB4571046`, posting over HTTPS |
| Wired IP | **`192.168.1.99`** ← use this one for the settings page |
| Wi-Fi IP | `192.168.1.7` — configured but inactive while the cable is in |
| Web page | `https://192.168.1.99` (admin) — self-signed cert, the browser warning is normal |
| Clock | GMT+05:00 Karachi, NTP on, DST off — **already correct, do not change** |
| People on device | 55, in departments incl. **Ai & Digital Division** |
| Mapped to Taskly | **none yet** — every scan lands as `unmatched` until mapped |
| Migration | `078_attendance_from_a_terminal.sql`, applied |

### The settings that made it work

**Configuration → Network → Advanced Settings → HTTP Listening**

| Field | Value |
|---|---|
| Event Alarm IP/Domain Name | `taskly.aidigitaldivision.com` |
| URL | `/api/attendance/device?serial=GB4571046&k=<SECRET>` |
| Port | `443` |
| Protocol | **HTTPS** ✅ *(it does support it — this was the open question)* |

The secret is in `.env.terminal-secret.local` — never committed, this repo is public.

---

## ⚠️ WHAT WE LEARNED ON THE DAY

Things that were guesses beforehand and are now facts.

**1. The terminal replays its ENTIRE stored history when first connected.**
The moment HTTP Listening was saved it began pushing seven months of events —
roughly 45,000 scans for 55 people. This contradicts what was assumed while
planning (that Hikvision push is fire-and-forget), and it is *good* news: it
means an internet outage is far less damaging than feared.

**2. That backlog had to be filtered out.** Every replayed event cost a database
round trip — 0.6 a second, about 20 hours to finish, filling the table with rows
that could never become attendance. The route now discards anything older than
**10 days** before touching the database. Throughput went to ~2.6 a second and
the table stopped growing. See `STALE_SCAN_DAYS`.

**3. Employee numbers carry leading zeros.** The device sends `"003"`, not `"3"`,
and matching is exact. Take the number from a real scan, never by retyping.

**4. Recognition method arrives correctly.** `subEventType: 75` = face,
`38` = fingerprint. The `currentVerifyMode` field describes what the door
*accepts*, not what was used, so it is only a fallback.

**5. Times arrive correct.** The terminal sends `+05:00` with every event and
they land accurate to the second in Karachi time.

**6. "Checking in failed" on the device screen is unrelated to Taskly.** That is
the terminal's own Time & Attendance module, which has no shifts configured
(`attendanceStatus: "undefined"`). It does not stop events being sent.

**7. Only ~8 of the 55 people on the device have Taskly accounts.** The rest will
scan as `unmatched` indefinitely. Harmless, but worth a decision.

---

## ✉️ EMAIL — FIXED 2026-08-30, NEEDS ONE RETEST

Creating an invitation failed with a Resend **403**: *"You can only send testing
emails to your own email address."*

**The cause was not DNS.** `aidigitaldivision.com` was verified in Resend 11 days
ago. But `EMAIL_FROM` on Vercel was set **15 days ago** — before the domain
existed — so it still pointed at the sandbox sender, and Resend treats those as
test-only.

**Fixed:** `EMAIL_FROM` on Vercel production is now
`Taskly <admin@aidigitaldivision.com>`, and production was redeployed.

⚠️ **Still to verify:** create one invitation and confirm the email actually
arrives. **This also affects invoices** — an invoice to a real client would have
failed the same way. The invoice test on 2026-08-29 only succeeded because it was
sent to `habibaminhas989@gmail.com`, the one address the sandbox allowed.

---

## REFERENCE — CHECKING IT IS ALIVE (2 minutes)

Open this in a browser:

**https://taskly.aidigitaldivision.com/api/attendance/device**

You should see exactly this:

```json
{"ok":true,"service":"attendance-terminal","expects":"POST"}
```

- **You see it** → the endpoint is live. Go to Step 2.
- **You see a 404** → the deploy has not finished, or Step 0 was skipped.

This page needs no password and gives nothing away, so it is safe to open from
anywhere and safe to send to somebody else to open.

---

## STEP 2 — SEND THIS TO WHOEVER IS AT THE WAH OFFICE

Everything between the lines can be copied and sent as-is. Replace `<SECRET>`
first — see **Where the secret is** at the bottom of this file.

---

> Please do this on a laptop connected to the **same Wi-Fi as the attendance
> device**. Send me a photo at each step where I ask.
>
> **1 — Find the device's address**
> On the device, press **OK** (or **Menu**) → **Network**.
> Write down the **IP address**. It looks like `192.168.1.64`.
> 📷 **Send me a photo of this screen.**
>
> **2 — Open the device on the laptop**
> Type that IP address into a web browser on the laptop.
> Log in with username `admin` and the device password.
>
> **3 — Fix the clock** *(important — this becomes everyone's arrival time)*
> Go to **Configuration → System → Time Settings**.
> - Time Zone: **GMT+05:00**
> - Turn **NTP** on
> - Save
> 📷 **Send me a photo of this screen.**
>
> **4 — Add yourself to the device**
> Go to **User Management** → add a new user.
> Register your **face** and your **fingerprint**.
> The device gives you an **Employee No.** (a number like `1001`).
> ✍️ **Tell me that number and your full name.**
>
> **5 — Find the event-sending settings**
> Go to **Configuration → Network → Advanced Settings → HTTP Listening**.
> If it is not there, look for **Event → Basic Event → Notification**, or
> **Network Service**.
> 📷 **Send me a screenshot of this page BEFORE changing anything.**
>
> **6 — Fill it in exactly like this**
>
> | Field | What to put |
> |---|---|
> | Protocol | **HTTPS** |
> | IP Address / Host Name | `taskly.aidigitaldivision.com` |
> | Port | `443` |
> | URL | `/api/attendance/device?serial=GB4571046&k=<SECRET>` |
> | Format | **JSON** (if it asks) |
>
> ⚠️ **If HTTPS is not in the Protocol list, stop and tell me.** That is the most
> important thing I need to know.
>
> **7 — Save, then press Test** (if there is a Test button)
> ✍️ **Tell me exactly what it says**, word for word.
>
> **8 — Scan your face at the device.** Wait 30 seconds and scan again.
> ✍️ **Tell me the time you scanned.**

---

## STEP 3 — WHAT TO COLLECT BACK FROM HIM

Tick these off. The first one decides everything else.

- [ ] **Was HTTPS in the Protocol dropdown?** ← the answer that matters most
- [ ] **What did the Test button say?**
- [ ] **His employee number and full name** (needed to map him)
- [ ] **His device's IP address**
- [ ] **The screenshot** of the HTTP Listening page
- [ ] **Roughly what time he scanned**

---

## WHAT THE THREE OUTCOMES MEAN

**A — A scan arrives.** Check with the SQL below; you will see a row with
outcome `unmatched`, because nobody is mapped in Taskly yet. **That is success** —
it proves the whole chain works end to end. Mapping him then takes one minute.

**B — Test passes but no scan arrives.** The connection works but the terminal is
not sending access events. There is usually a second setting for *which* event
types get pushed. Send me the screenshot and I will find it.

**C — HTTPS is missing, or the Test fails.** The terminal cannot reach a hosted
site directly. Not a disaster — we add a small always-on machine in the Wah
office as a bridge. It talks to the terminal over the local network, where there
is no HTTPS problem, and forwards to Taskly.

---

## HOW TO CHECK FOR YOURSELF

Run this in the Supabase SQL editor. It answers "has the wall ever spoken to us".

```sql
-- Has the terminal reached us at all?
select serial_no, label, last_seen_at, last_event_at
  from public.attendance_devices;

-- Every scan, newest first.
select employee_no, method,
       to_char(scanned_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI:SS') as scanned,
       outcome, on_date
  from public.attendance_scans
 order by scanned_at desc
 limit 20;
```

- `last_seen_at` filled in → the terminal reached Taskly.
- A scan with outcome `unmatched` → it worked, that person just is not mapped.

### Mapping somebody once you have their number

```sql
do $$
declare v_admin uuid;
begin
  -- Acting as you. Only an Admin may enrol somebody — enforced by trigger.
  select id into v_admin from public.users where email = 'ummehabiba989@gmail.com';
  perform set_config('app.user_id', v_admin::text, true);

  update public.users
     set device_person_no = '1001'          -- ← his number on the device
   where email = 'kashif@cni-demo.com';     -- ← the Taskly account
end $$;
```

### Making somebody terminal-only

Once the wall is trusted, this refuses the Taskly button for office staff. Remote
people stay on `either`.

```sql
do $$
declare v_admin uuid;
begin
  select id into v_admin from public.users where email = 'ummehabiba989@gmail.com';
  perform set_config('app.user_id', v_admin::text, true);

  update public.users
     set attendance_mode = 'terminal_only'
   where email = 'kashif@cni-demo.com';
end $$;
```

---

## ⚠️ THE WI-FI LIMITATION — READ THIS ONCE

The terminal holds **100,000 scans in its own memory**, so nothing is lost *on
the device* when the internet drops.

**But Hikvision's push is fire-and-forget — it does not resend what failed.** So
scans made during an outage stay on the terminal and never reach Taskly by
themselves.

Getting them back needs something on the office network that can *ask* the
terminal for them. Vercel cannot: the terminal sits behind your router. That is
what the bridge is for.

**Until the bridge exists, treat an internet outage as lost attendance for those
hours** and correct those days by hand. The receiving side already handles a
replayed batch correctly, so adding the bridge later needs no change here.

---

## REFERENCE

### The terminal

| | |
|---|---|
| Model | Hikvision DS-K1T320MFWX |
| Serial | `GB4571046` |
| MAC | `a4:d5:c2:67:e1:d1` |
| Firmware | V3.5.20 build 20241227 |
| Holds | 500 faces · 1,000 fingerprints · 1,000 cards · 100,000 events |
| Speaks | ISAPI over HTTP, and ISUP 5.0 |

### The URL the terminal posts to

```
https://taskly.aidigitaldivision.com/api/attendance/device?serial=GB4571046&k=<SECRET>
```

### Where the secret is

⚠️ **It is deliberately not written in this file — this repository is PUBLIC on
GitHub.**

The ready-to-paste URL, with the secret already in it, is in:

```
.env.terminal-secret.local
```

in the project root. That filename matches `.env*` in `.gitignore`, so it never
leaves your machine.

### Rotating the secret

Do this once testing is finished, because the original was typed into a chat.

```sql
-- Pick a new random secret, put the SAME value in the device's URL.
do $$
declare v_admin uuid;
begin
  select id into v_admin from public.users where email = 'ummehabiba989@gmail.com';
  perform set_config('app.user_id', v_admin::text, true);

  update public.attendance_devices
     set secret_hash = app.hash_device_secret('paste-a-new-random-string-here')
   where serial_no = 'GB4571046';
end $$;
```

The database only ever stores the hash, so nobody — including anybody reading the
database — can recover the secret from it.

---

## WHAT COMES AFTER THE TEST

1. **Map everybody** — enrol each person on the terminal, then map their number.
2. **The admin screen** — so none of the SQL above is needed again.
3. **Move office staff to `terminal_only`** once you trust the wall.
4. **The bridge**, if HTTPS failed or when you want outage-proof attendance.
