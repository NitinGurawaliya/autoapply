# SwipeApply — Creative Brief

We are not asking for a reskin. We want you to rethink how this app looks, feels and flows. Treat everything below as the *problem* to solve, not a layout to copy. Wherever this brief says what the user needs to know or do, you decide how to show it.

## The product

**Upload your resume once, swipe right on jobs, and an AI agent applies for you.**

Applying to one job on a company's form takes 10–20 minutes of retyping the same details. Early-career software engineers in India send hundreds of these per job search. Bots exist, but they spam and make things up, so recruiters filter them out.

SwipeApply's agent is different: it is **honest and accountable**.

- It only applies where you swiped right.
- It never invents anything about you. Every value it fills in comes from your resume, from you, from a sensible default, or (only for cover letters and open text) from an AI draft that is clearly marked as one.
- It never guesses money, notice period or visa answers. If it doesn't know one, it pauses and asks you.
- You can always see what it did, what it is doing now, and why something didn't go through.

**Who it's for:** software engineers in India with 0–5 years of experience. They are busy, a bit anxious about the job hunt, and live on their phone.

**How it should feel:** effortless and a little delightful to swipe, calm and trustworthy when it reports back. Think of the satisfaction of a great swipe app combined with the clarity of a great banking or delivery-tracking app. Never spammy, never noisy.

## Platform

- **Native-feeling mobile app** (iOS/Android), designed at 390 × 844. Light and dark.
- Built later with React, Tailwind and shadcn/ui, with Framer Motion for motion. So aim for something we can build: real components, purposeful motion, nothing that needs a 3D engine.
- Current rules we'd like to keep: one brand accent colour (your choice), no emoji in the UI, no gradients. If breaking a rule clearly makes the design better, show us and tell us why.

## The experience, moment by moment

### 1. Getting started
The user signs in with Google, gives us their resume (PDF), checks what we understood from it, and answers a handful of questions every application asks: current and expected salary (CTC), notice period, the kind of job they want, and where they want to work. If they pick abroad, we also ask about visa status and sponsorship.

**Design challenge:** this should take under 3 minutes and feel like setting up something exciting, not filling out a form. Reading the resume takes 5–15 seconds; make that wait feel good. The user has to trust that what we extracted is right and be able to fix it easily. Salary-type answers are sensitive, so reassure them we never guess these.

### 2. Discovering jobs (the heart of the app)
The user sees matched jobs one at a time and decides: apply or skip. Swipe gestures, plus an obvious tap alternative.

**To decide in about 2 seconds, they need:**
- the role and company
- how well it matches them, as a score out of 100
- *why* it matches, in a short sentence (e.g. title and skills overlap, experience fits)
- where it is and whether it's remote, and how fresh the posting is
- how much experience it asks for

Some extra signals are available, such as "this company usually needs an emailed code" or "often fails to submit", and they can open the original posting.

They can narrow what they see by location (India / Remote / US / Other), experience asked, and how recent the posting is. They have a daily application limit and should sense how much of it they've used.

**Design challenge:** make swiping feel great: the physics, the feedback, the moment a card commits. Design what happens when they run out of jobs or filters return nothing. Show what happens right after they swipe right, so they know the agent has picked it up.

### 3. The agent working for them
After a right swipe, the agent works in the background through these stages: waiting in line → reading the form → filling it → submitted. Sometimes it ends up blocked by one of our rules (e.g. the match is too low, they already applied, or they've hit the daily limit) or failed (e.g. the job closed, or the form rejected something).

**Design challenge:** the user should always feel in control and informed without babysitting. At a glance they need to see what's in progress, what's done, and what needs them. When something didn't work, they need to understand why in plain words and know what to do (retry, or nothing).

### 4. When the agent needs them
Sometimes a form asks something the agent doesn't know (e.g. "Can you work from our Bengaluru office 3 days a week?"), or the job board emails the user a security code. The application pauses until they answer. This can happen while they're anywhere in the app, or out of it (push notification). Answers are remembered, so the same question is never asked twice.

**Design challenge:** make interruptions feel helpful, not annoying. Answering should be quick, especially entering a code. If several applications are waiting, handle that gracefully.

### 5. Looking back at an application
For any application, the user can see:
- the story of what happened, step by step, and where it is now or where it stopped
- **everything that was filled in**, each value showing where it came from: your resume, you, a default, or an AI draft
- a screenshot of the form just before it was sent
- what to do next if it didn't go through

**Design challenge:** this is where trust is earned. A user should be able to look and think, "it said exactly what I would have said, and nothing it made up." Make provenance visible and beautiful, not a debug table.

## Scope

Design these: **Sign in, Onboarding, Feed (with filters), Agent-needs-you moment, Applications overview, Application detail.**

Navigation is yours to decide. The app has two main places, discovering jobs and tracking applications, plus a way to sign out.

Out of scope: settings, governance/rules page, data export, saved-answers manager.

## What we want back

1. A short design direction: the concept, feel, colour and type choices, and motion principles. Give 2–3 contrasting directions first if you can.
2. High-fidelity screens for every moment above, including loading, empty and error moments.
3. Key interactions prototyped: the swipe, the after-swipe moment, the agent progress, and the needs-you interruption.
