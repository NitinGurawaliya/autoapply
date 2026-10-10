# SwipeApply — Design Brief

Paste this whole file into the design tool. It explains the product and lists every screen to design, with the real data, actions, copy and states each one needs.

## 1. What SwipeApply is

**Upload your resume once, swipe right on jobs, and an AI agent applies for you.**

Applying to a job on a company's application form takes 10–20 minutes of retyping the same details. Early-career software engineers in India send hundreds of these per job search. Most auto-apply bots spam and make things up, so recruiters filter them out.

SwipeApply is different because the agent is **governed**:

- It only applies to jobs the user swiped right on.
- It never invents facts. Every value it fills in is labelled with where it came from: **Resume**, **You** (the user typed it), **AI draft** (only cover letters and free-text answers), or **Default**.
- Sensitive answers (salary, notice period, visa/sponsorship) come only from the user. If the agent doesn't have one, it pauses and asks.
- Every step is recorded, so the user can see exactly what was filled in and what happened.

**Target user:** Indian software engineers with 0–5 years of experience, applying to startups and global companies.

**Mood:** calm, trustworthy, fast. It should feel like a dating-app swipe made for something serious. It's playful in how you use it but plain and honest in what it tells you. The tone is a helpful assistant, not a hype machine.

## 2. Platform and constraints

- **This is a mobile app.** Design at 390 × 844 (iPhone 14-size). Thumb-reachable primary actions, bottom tab bar, bottom sheets instead of centred dialogs, safe areas respected.
- One brand accent colour (currently indigo `#4f46e5`, open to change) plus fixed status colours (below). Light and dark themes.
- **No gradients. No emoji in the UI.** Simple line icons (Lucide style).
- Rounded corners (~12px on cards), soft shadows, generous spacing, tight headline tracking.
- Every screen needs **loading**, **empty** and **error** states.

### Status colours (fixed meaning across the app)

| Status | Label | Style |
|---|---|---|
| queued | Queued | grey |
| inspecting | Reading form | blue, animated/pulsing |
| filling | Filling | blue, animated/pulsing |
| needs_input | Needs your input | amber |
| submitted | Submitted | green |
| failed | Failed | red fill |
| blocked | Blocked | red outline |
| cancelled | Cancelled | grey outline |

### Source badges (where a filled-in value came from)

| Source | Badge | Style |
|---|---|---|
| resume | Resume | grey |
| user | You | blue |
| ai_draft | AI draft | purple |
| default | Default | outline |

## 3. Scope: screens to design

**In scope:**

1. Sign in
2. Onboarding: Upload resume → Confirm profile → Common questions
3. Feed: swipe deck, job card, filter sheet, empty states
4. "Needs your input" sheet, shown over any screen
5. Applications: list and detail

**Out of scope for now:** the Governance page and the Account/data page.

**App structure:** a bottom tab bar with **Feed** and **Applications**, plus a small profile/avatar entry in the top bar for sign out. The Applications tab shows an amber count badge when applications are waiting for the user.

---

## 4. Screens in detail

### S1. Sign in

- Logo + "SwipeApply" wordmark.
- One-line value prop, for example: "Swipe right on jobs. A governed agent applies only after you do."
- One full-width button: **Continue with Google**.
- States: button loading; sign-in failed (inline message plus retry).
- There's room for a small illustration or a 3-step "Upload · Swipe · We apply" explainer. Keep it light.

### Onboarding (S2–S4)

Three steps, shown with a **step indicator** (1 of 3, 2 of 3, 3 of 3). The current build has no indicator, so add one. These screens have no tab bar. Each should feel quick: the whole of onboarding should take under 3 minutes.

#### S2. Upload resume (step 1)

- Heading "Upload your resume", subtext "PDF only. We use only what is written on it."
- A large tap target to pick a PDF (on mobile this opens the file picker). After picking, show the file name and size.
- Primary button **Continue**.
- States:
  - Reading the resume takes about 5–15 seconds. Show a progress state, e.g. "Reading your resume…", ideally with steps like "Extracting experience, skills…".
  - Errors: no file chosen ("Choose a PDF resume."); unreadable PDF ("Could not read that PDF. Try another file.").
- Secondary: Sign out.

#### S3. Confirm profile (step 2)

Heading "Check your details", subtext "We pulled these from your resume. Fix anything that is wrong."

Editable fields, grouped:

- **Contact:** Full name*, Email*, Phone, City, Country
- **Links:** LinkedIn, GitHub, Portfolio
- **Career:** Years of experience (e.g. 2.5), Current title, Current company
- **Skills:** editable chips (add/remove), e.g. React, TypeScript, Postgres
- **Experience:** a read-only list of "Title — Company" rows (empty: "No experience found on your resume.")
- **Education:** a read-only list of School · Degree · Year. It is extracted today but not shown yet, so add it here.

Primary sticky bottom button: **Looks good**. It saves and goes to step 3. States: saving, save failed, loading the profile.

#### S4. Common questions (step 3)

Heading "A few quick questions", subtext "Applications ask these all the time. We save your answers and never guess them."

| Question | Control |
|---|---|
| Current CTC | text/number (₹, e.g. "12 LPA") |
| Expected CTC | text/number |
| Notice period (days) | number |
| Employment type | single choice: Full-time / Part-time / Contract / Internship |
| Where do you want to work? | multi-choice chips: India / US / Other |
| Work authorization | Authorized / Not authorized. **Only shown if US or Other is chosen** |
| Need visa sponsorship? | Yes / No. **Only shown if US or Other is chosen** |

- A small trust note near the salary fields: "Sensitive answers are only ever filled from what you type, never written by AI."
- All questions are required. Show inline per-field errors.
- Primary button **Start swiping**, which goes to the Feed.

Optional, recommended: one more toggle, "Tick standard privacy and 'my answers are true' checkboxes on forms for me" (Yes/No). Without it, the agent asks every time.

---

### S5. Feed (main screen)

**Top area:**

- Title "Feed" (or just the logo) and a **Filters** button with a count badge for active filters.
- Daily usage line: "Applied today: 7 of 20". It turns amber at 80% and says "Daily limit reached" at the cap.
- Active filters as small pills, e.g. "India, US" · "Up to 5 years" · "Last 7 days", plus **Reset**.

**Swipe deck:**

- One card on top, with 1–2 cards peeking behind it (slightly offset and scaled).
- **Drag right = Apply.** The card tilts, a green tint builds, and an **APPLY** stamp appears.
- **Drag left = Skip.** A grey tint and a **SKIP** stamp appear.
- A short drag springs back.
- Below the deck: two large buttons, **Skip** (outline, X icon) and **Apply** (primary, check icon).

**Job card contents:**

| Element | Example |
|---|---|
| Company avatar (initials on a tinted tile) | "RZ" |
| Job title | Frontend Engineer |
| Company | Razorpay |
| **Match ring**: circular progress with the % inside | 82% (green ≥70, accent ≥50, amber <50) |
| Location | Bengaluru (or "Location not listed") |
| Posted | 3 days ago |
| Tags | Remote / Hybrid / On-site · "Entry level" (green) or "3+ yrs asked" · up to 4 matched skills as pills |
| Warning tag (amber, optional) | "Often fails to submit" or "Usually needs an emailed code" |
| Reason (max 2 lines) | "Title matches frontend, engineer. Skills: React, TypeScript, Node" |
| Link | View job ↗ (opens the posting) |

**Feedback after a swipe (toasts/snackbars):**

- Apply: "Applying to Razorpay. Track it under Applications."
- Queue full: "Your queue is full. Wait for a few to finish, then swipe again." The card returns to the top.
- Blocked by a rule: "Razorpay: match too low" (friendly wording, not a raw rule id).
- Network failure: "Could not save that swipe. It is back on top."
- Skip: no toast.

**States:**

- Loading: a skeleton card.
- No jobs match the filters: icon, "No jobs match these filters", "Try more places, any experience, or the last 30 days.", button **Reset filters**.
- No jobs at all: "New jobs show up here as companies post them.", button **See your applications**.
- Deck finished: check icon, "You are all caught up", "New jobs arrive as companies post them.", buttons **See your applications** and **Reset filters**.
- Error: "Could not load the feed." with **Try again**.

#### S5a. Filter sheet (bottom sheet)

Title "Filter jobs". Sections of chips:

- **Where:** India / Remote / US / Other (multi-select; all on by default)
- **Experience asked:** Any / Up to 3 years / Up to 5 years / Up to 10 years (single)
- **Posted:** Last day / Last 7 days / Last 30 days (single, default 30)
- (Job board: Greenhouse / Lever / Ashby. Shown only when more than one board is enabled. Today only Greenhouse is on, so it can be hidden.)

Footer: **Clear all** and **Show N jobs** (or **Apply**).

---

### S6. "Needs your input" sheet (global)

The agent hits a question it doesn't have an answer for, or the job board emails a security code. The application **pauses** and this sheet appears over whatever screen the user is on.

- Title: "Razorpay asks"
- Subtext: "Frontend Engineer. Your answer is saved and the application continues." Plus "2 more waiting after this." when there are more.
- One or more fields, each either a text input or a single-choice list. Examples:
  - "Are you willing to work from our Bengaluru office 3 days a week?" (Yes/No)
  - "Expected CTC"
  - **Security code:** "Enter the code Greenhouse emailed you". Design this one as a distinct OTP-style input (6–8 characters).
- Primary button **Save and continue**.
- It can't be dismissed without answering. A secondary "Cancel this application" link is acceptable.
- Errors: "Answer every question."; "This application is no longer waiting."; "Could not save. Try again."
- On mobile this is also a **push notification**: "Razorpay needs an answer — your application is paused until you answer." Tapping it opens this sheet.

---

### S7. Applications list

- Title "Applications", subtext "Everything you applied to, and what was filled in." Daily usage line.
- **Summary tiles (4)** that are also filters. Tap to filter, tap again to clear.
  - **Submitted** (green)
  - **In progress** (blue: queued, reading, filling)
  - **Needs you** (amber)
  - **Failed** (red: failed, blocked, cancelled)
- When filtered: "Showing 3 submitted" · **Show all**.

**Row card:**

- Avatar, job title, company, status badge.
- Meta line: "Bengaluru · Submitted 3 hours ago" or "Started 12 min ago".
- Anything not yet submitted also shows a plain-language outcome: a bold coloured headline plus the next step. Examples:
  - "In line. You are next." / "3 ahead of this one."
  - "Waiting for your answer. Answer the question and it continues."
  - "Match too low. This job scored below your minimum."
  - "This job is closed."
- Inline actions where relevant:
  - Queued: **Cancel**.
  - Running: **Cancel**, which asks to confirm ("Yes, cancel" / "Keep running").
  - Failed or cancelled: **Retry**.

The list updates live while applications run, with an animated status badge.

**States:**

- Loading: tile and row skeletons.
- Empty: "No applications yet. Swipe right on a job and it shows up here, with everything we filled in.", button **Go to the feed**.
- Empty filter: "Nothing here", button **Show all**.
- Error: "Could not load your applications." with **Try again**.

### S8. Application detail

1. **Header:** back arrow, avatar, job title, company, status badge, "Bengaluru · Submitted 9 Oct, 3:42 pm", "View job posting ↗".

2. **Outcome callout** (when not submitted): a coloured card with a headline, the next step and actions (Retry / Cancel). Example headlines:
   - Queued: "In line"
   - Running: "Reading the application form" / "Filling in the form"
   - Needs input: "Waiting for your answer" / "Waiting for your security code"
   - Blocked: "Match too low", "Already applied to this role", "Daily limit reached. It resets at midnight."
   - Failed: "This job is closed", "Security code rejected", "Your resume would not upload", "Something went wrong"

3. **"What happened"** is a vertical timeline. Steps:
   - Rules checked
   - Application form read
   - Answers prepared
   - Waited for you (optional)
   - Form filled in
   - Security code entered (optional)
   - Submitted, with a confirmation note

   Each step is **done** (green check), **current** (pulsing accent dot, "in progress"), **stopped** (red X, "stopped here") or **to do** (grey). This is the key "watch the agent work" moment, so make it feel alive while it runs.

4. **"What was filled in · 24 fields"** shows field rows grouped into cards: Contact, Links, Documents, Experience, Your answers, Equal opportunity. Each row is the label, the value, and a **source badge** (Resume / You / AI draft / Default). This is the trust centrepiece: the user should be able to see at a glance that nothing was made up.
   - Empty: "The list appears here once the form has been filled in."

5. **"Form before submitting"** is collapsed and holds a screenshot thumbnail that opens full screen.

6. **"Technical details"** is collapsed and holds the raw event log (time · event · message). It's low priority visually.

**States:** loading; not found ("Application not found", button back to the list); error. The screen updates live while the application runs.

---

## 5. Key flows to prototype

1. **First run:** Sign in → Upload resume (reading…) → Confirm profile → Common questions → Feed.
2. **Swipe right:** card flies off → toast "Applying to X" → the Applications badge updates → the row goes Queued → Reading form → Filling → Submitted (green) → detail shows the timeline and filled fields with sources.
3. **Agent needs you:** push notification → the needs-input sheet opens → the user answers → the sheet closes → the timeline resumes.
4. **Blocked or failed:** the row shows a friendly reason and Retry.

## 6. What makes the design succeed

- Swiping feels fast and fun; the card is scannable in under 2 seconds (title, company, match %, why).
- The user always knows what the agent is doing right now and what, if anything, it needs from them.
- Trust is visible: source badges, "never guessed" notes and a clear timeline. There are no hidden actions.
