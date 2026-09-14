# 11 · Calling — what is possible, what it costs, and which route to take

**Status: RESEARCHED, NOT BUILT. Deliberately parked.**
Owner, 2026-09-14: *"I'm not talking about implementing this right now but
definitely once the system is running and everything is working, I will implement
this thing."*

**Read this when the owner says "calling", "call recording", "auto-dial",
"click-to-call", or "talk on mobile".** It holds the whole answer so the question
does not have to be researched a second time.

---

## Where this came from

It started as a correction. I described the next few weeks as the testers
"sending messages and taking calls", and the owner picked it up:

> *"You are saying 'sending messages and taking calls'. Is the call facility
> available in the WhatsApp API?"*

Then the real question, twice sharpened:

> *"Is it possible that when I click on WhatsApp on the system, it will
> auto-call on mobile… the mobile can sync with the CRM so that when I click on
> WhatsApp here, it auto-dials their mobile from their mobile to that person?
> It is actually happening in the meen.com CRM dashboard."*

> *"I'm not saying that to record the call, which is dialing from a SIM. I'm
> saying that I'm using the WhatsApp API to call. Instead of talking on a
> desktop, if he wants to talk on a mobile, is it not possible?"*

⚠️ **"meen.com" is Zameen.com** — the reference CRM named in `README.md`, whose
left rail carries **Call Recordings** between Sales Dispute and the rest. That
screenshot is where this whole question comes from, and it is the standard the
owner wants to match.

⚠️ **AND THE SECOND QUOTE IS THE ACTUAL QUESTION.** My first two answers were
about SIM calls and about recording, because that is what I assumed "auto-dial"
meant. It was not. The question is: *the WhatsApp call already exists — why must
the salesperson be sitting at a desktop to take it?* The answer is that he must
not. See **Route B**.

---

## 1 · What the CRM does today

The Call button on the desk row and on the lead record is a **`tel:` link**. It
hands the number to the device: on a phone it opens the dialler, on a desktop it
usually does nothing useful.

⚠️ **NOTHING IS RECORDED AUTOMATICALLY, AND THAT IS HONEST RATHER THAN MISSING.**
`components/crm/lead-record.tsx` says so at the button:

> *"`tel:` IS STILL A LINK THAT RECORDS NOTHING, and that is the honest state of
> a phone call… a button that looked like it logged a call while logging nothing
> would make the timeline below lie about work that was actually done."*

What IS recorded is the **outcome**, because a human presses it: *Spoke to
them · No answer · Tried to call · WhatsApp sent · Email sent*. That feeds the
activity timeline, the follow-up dates and `median_response_minutes`.

**So today, calling is tracked, not carried.**

---

## 2 · Does the WhatsApp API do voice calls?

**Yes.** Meta's **Business Calling API** — VoIP, both directions:

- **User-initiated** (they call the business): available globally wherever Cloud
  API operates.
- **Business-initiated** (we call them): **blocked for numbers in the United
  States, Canada, Egypt, Vietnam and Nigeria.** `+92` is not on that list, so a
  Pakistani business number is fine.

### ⚠️ Two hard gates, both measured 2026-09-14

| Gate | Requirement | Where we are |
|---|---|---|
| **Messaging tier** | ≥ **2,000** unique recipients/day | **`TIER_250`** — measured on `1270997902767734` |
| **Number country** | not US/CA/EG/VN/NG for business-initiated | the test number is **`+1 555-660-8298`** — blocked |

```
GET /v26.0/1270997902767734
  display_phone_number     "+1 555-660-8298"
  verified_name            "Test Number"
  quality_rating           GREEN
  messaging_limit_tier     TIER_250
  throughput               STANDARD
  platform_type            CLOUD_API
```

⚠️ **THE TIER IS NOT A FORM TO FILL IN.** It rises on its own as real messages go
to real people with good quality. So *using the desk for a few weeks is itself
the prerequisite* — this cannot be brought forward by deciding to.

Other production limits, per business-user pair: 1 call permission/day, 2/week;
2 consecutive unanswered calls trigger a reconsideration message; 4 revoke
permission automatically.

---

## 3 · Can he talk on his mobile instead of a desktop? — **Yes**

This is the owner's actual question, and the answer is that **the business leg of
a WhatsApp call is just an endpoint, and where it runs is our choice.** Nothing
about the API requires a desktop browser.

| | Route | Where he talks | Effort | Rings when phone is locked? |
|---|---|---|---|---|
| **A** | **Mobile browser** — the CRM page itself holds the WebRTC leg | his phone, in Chrome | least | ❌ no — fine for outgoing, weak for incoming |
| **B** | **SIP → PBX → softphone** ⭐ | his phone, like a normal call | middle | ✅ yes |
| **C** | Native app + WebRTC + ConnectionService / CallKit | his phone, fully native | most | ✅ yes |

### ⭐ Route B is the recommendation

Meta supports **SIP as the signalling protocol instead of the Graph API
endpoints**. Their own words: *"configure your SIP server on the business phone
number for calling"*, to *"leverage current PBX systems and softphones."*

The flow becomes:

```
customer taps call in WhatsApp
   → Meta
   → our SIP server / PBX
   → rings the salesperson's phone (any standard softphone)
   → he talks on mobile
```

**Why B and not A or C:**

- It rings properly when the phone is locked, which A cannot do — a browser tab
  is not a phone.
- **Recording comes free, on the server**, because the media crosses our PBX.
  Queues, transfers and IVR come with it. That is the Zameen "Call Recordings"
  column, without writing any of it.
- It is off-the-shelf. A PBX is a solved problem; a WebRTC client with push
  wake-up, ICE/TURN and audio-device handling is not.

**SIP requirements:** a standards-compliant third-party SIP server with **TLS
transport and digest authentication**, valid certificates with matching
hostnames, and the app in **Live mode** (not Development). Media supports both
WebRTC (DTLS-SRTP) and SDES. Optional webhooks give call-lifecycle events, which
is how a call would get written into `crm_lead_activity`.

---

## 4 · ⚠️ Three dead ends, so nobody tries them again

### 4a · An APK will not give you call recording

The owner asked whether building an APK of the CRM would let it auto-dial and
record. Dialling — yes, trivially (`ACTION_CALL` / `ACTION_DIAL`) — **but that is
already what the `tel:` link does in a phone browser, so the APK buys nothing.**

Recording is a wall, not a difficulty:

- Android blocked real call recording at **Android 6**, and the microphone route
  at **Android 10**.
- Developers used the Accessibility API as a workaround. **Google banned that
  from the Play Store on 11 May 2022**: *"The Accessibility API is not designed
  and cannot be requested for remote call audio recording."*
- The only survivors are the phone maker's own dialler recorders (Xiaomi,
  Samsung in some regions). **An app cannot reach those.**

⚠️ **This is precisely why Route B exists.** The recording happens on the
**server**, not the handset, so Android's restrictions never apply. Any product
showing you call recordings from a dashboard is doing it server-side.

### 4b · WhatsApp has no deep link for placing a voice call

`wa.me/<number>` opens a **chat**, not a call. There is an undocumented Android
contacts trick (`vnd.android.cursor.item/vnd.com.whatsapp.voip.call`) but the
number must be saved in the handset's address book first and it breaks whenever
WhatsApp changes. Not a foundation.

### 4c · "Click on desktop, their mobile rings" via a telephony provider is a
### DIFFERENT product

Twilio / Exotel / Knowlarity / Ozonetel call the salesperson first, then the
customer, and bridge the legs — recorded, because the provider sits in the
middle. This works today, has no tier gate, and needs no WhatsApp at all.

⚠️ **But it is ordinary phone calls, not WhatsApp calls**, and it carries a
per-minute bill forever. Worth knowing as the fallback if WhatsApp calling stays
out of reach; not worth building while Route B is the goal.

---

## 5 · What has to be true before any of this starts

In order, and the first one cannot be skipped:

1. **Messaging tier ≥ 2,000/day.** Earned by real use. This is the reason the
   answer to "can we do it now" is no.
2. **Our own Pakistani number on Cloud API**, not Meta's `+1` test number — see
   `00-STATE-AND-TRACKER.md` for the SIM situation on `+92 342 7438726`.
3. **Live app mode.** SIP will not configure in Development.
4. **A SIP server** with TLS and digest auth, plus somewhere to keep recordings —
   and a decision about consent, which is a business question, not a technical
   one.

**Until then, the honest arrangement is the one already built:** the salesperson
opens the CRM on their phone, taps Call, talks on their own line, and taps the
outcome. The call is tracked, and the CRM never claims more than that.

---

## Sources

- [Meta — WhatsApp Business Calling API](https://developers.facebook.com/docs/whatsapp/cloud-api/calling) — call types, country restrictions, the 2,000/day requirement, per-pair call limits
- [Meta — SIP configuration for WhatsApp Business Calling](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/sip) — SIP instead of Graph API, TLS + digest auth, Live mode, PBX and softphone reuse
- [WebRTC.ventures — integrating the WhatsApp Calling API with WebRTC](https://webrtc.ventures/2025/11/how-to-integrate-the-whatsapp-business-calling-api-with-webrtc-to-enable-customer-voice-calls/) — the SDP offer/answer handshake on the business leg
- [9to5Google, 21 Apr 2022](https://9to5google.com/2022/04/21/google-will-block-all-third-party-call-recording-apps/) and [XDA](https://www.xda-developers.com/google-kill-third-party-call-recording-apps-android/) — the Play Store ban on third-party call recording, effective 11 May 2022

Measured facts in section 2 came from the live Graph API on 2026-09-14, not from
these pages.
