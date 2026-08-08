# Product

## Register

product

## Users

Solo freelancers and independent consultants tracking billable work across
multiple clients.

Their context: the app is an always-open desktop companion, pinned in a tab or
window beside the work it is measuring, for the length of a working day. It sits
in peripheral vision for hours and is looked at directly only in short bursts —
starting something, stopping it, writing a line about what just happened.

The job to be done: know where the day went accurately enough to bill for it,
and be able to say what was actually accomplished without reconstructing it from
memory. The output is used two ways — a recap for the user's own record or
standup, and a defensible account of the work behind an invoice.

> **REMOVED 2026-08-08.** The recap was built, shipped, and then cut to make
> room for the dashboard shell — see
> `docs/superpowers/plans/2026-08-08-dashboard-sidebar-shell.md`. Notes are
> retained: they now serve **Reports**, which searches note text, rather than
> composing into a recap. The paragraph above is left standing because it is
> the argument the product was designed around.

## Product Purpose

A time tracker that captures what was accomplished, not only how long it took.

Every entry carries a title, and optionally a short note about progress, context,
or outcome. At the end of a day those entries and notes compose into a recap the
user can read, paste into a standup, or hand to a client.

Conventional trackers produce a number of hours and no memory. The hours alone
cannot answer "what did I actually do on Tuesday" — the question that matters
when writing an invoice, justifying a line item, or reporting to a client.

Success looks like: a user reaches the end of the day and the recap is already
essentially written, because capture during the day cost them almost nothing.

The initial core is deliberately narrow — start/stop and manage entries, title
each session, attach an optional note, review history, generate a daily recap.

> **REMOVED 2026-08-08.** "Generate a daily recap" and the two paragraphs
> above describing it were the plan, not the shipped product — the recap was
> cut the same day the dashboard shell landed. What remains: start/stop and
> manage entries, title each session, attach an optional note, and search
> across all of it in Reports. See the shell plan for why.

## Brand Personality

Quiet, precise, dependable.

It recedes while you work and is exact about the numbers. Voice is plain and
factual: it states what happened and what it recorded. It does not congratulate,
scold, or editorialize about productivity.

Emotional goal is trust rather than delight. The user is billing from this data;
the interface should feel like something that will not lose their afternoon.

## Anti-references

- **Gamified productivity.** No streaks, badges, confetti, mascots, or
  productivity scores. Billable time is not a game, and shame mechanics around
  untracked hours are actively harmful to the user's relationship with the tool.
- **Enterprise timesheet software.** Not Harvest, Jira Tempo, or SAP-era
  timesheets — no dense approval grids, nested project taxonomies, or
  submit-at-end-of-week ceremony.
- **Generic SaaS startup.** No purple-to-blue gradients, floating 3D blobs,
  glassmorphic cards, or the big-number hero-metric template. This is the default
  look of an AI-generated dashboard and it signals nothing.
- **Playful consumer app.** Not Duolingo or Headspace — no rounded-everything,
  bright illustration, emoji-forward copy, or cheerful anthropomorphism.

Taken together these rule out both directions the category usually runs in:
the corporate timesheet and the cheerful habit tracker. What is left is a quiet
instrument.

## Design Principles

**The note is the product.** Hours are commodity; what got done is the reason
this exists. Capturing a note must cost less effort than skipping it. Any
friction added to the note path is a direct attack on the core value.

**Recede, then report.** The interface is in peripheral vision for eight hours
and read closely for two minutes. Ambient state must be legible at a glance and
must not compete for attention; the recap was the one moment the product was
allowed to be assertive. **REMOVED 2026-08-08** along with the recap itself —
Reports is the closest surviving moment of assertiveness, and it is a table,
not prose.

**Never lose time.** A tracker that drops an entry is worse than no tracker,
because the user stops trusting it and the data becomes unusable for billing.
Running state survives reloads, navigation, and crashes. Ambiguity about whether
something is being tracked is a defect.

**Defensible by default.** This data becomes invoices. Entries are attributable,
editable with intent, and exportable. The product never silently rounds,
merges, or guesses on the user's behalf.

**Keyboard before pointer.** An all-day companion is used by muscle memory.
Start, stop, retitle, and note are reachable without the mouse. The pointer path
must exist and work, but it is not the path being optimized.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA.** Body text at 4.5:1 minimum against its background,
visible focus indicators throughout, full keyboard operability.

**Keyboard-first, beyond what AA requires.** Every core action — start, stop,
title, note, switch entry — is reachable without a pointer and carries a real
shortcut. This follows from the always-open companion context, not just
compliance.

**Never encode meaning in color alone.** Running versus stopped, billable versus
not, and every status must also carry shape, text, or icon. This matters for
colour-blind users and equally for glanceability: state must be readable in
peripheral vision, where hue is the first thing the eye loses.

**Reduced motion is honoured throughout** as a baseline house rule rather than a
project-specific choice. It carries unusual weight here because a running timer
implies continuously updating UI; every animation needs a
`prefers-reduced-motion` alternative, and a live-updating duration must remain
readable without implying motion.
