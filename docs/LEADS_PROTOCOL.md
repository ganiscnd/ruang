# Leads protocol (Hermes board: `leads`)

Human summary. Agents get the full rules from the Hermes skill
`hermes/skills/leads-protocol/SKILL.md`, which Ruang force-loads on every work card (`--skill`).
Keep both in step.

## Tools

Use the kanban tools (`kanban_show`, `kanban_comment`, `kanban_complete`, `kanban_block`). Never
shell out to `hermes kanban`. Never create or link cards, and finish with `kanban_complete`, never a
review request.

## What a lead looks like

A lead is one card on the board `leads`. Its title is the Upwork job title. Its body starts with a
`[lead]` block, then a line `---`, then free notes:

```
[lead]
client: Northline Builders LLC
budget: hourly 45-65 USD          (or: fixed 1500 USD, or: unknown)
upwork_url: https://www.upwork.com/jobs/~01...
posted: 2026-10-23                (YYYY-MM-DD)
fit: 4                            (1-5)
tags: n8n, procore, rfi
---
free notes
```

Do not change the `[lead]` block. Never assign, block, archive or complete a lead card.

## Your job

You work on a separate **work card**. Its title starts with `[lead <lead id>]`, and its body starts
with `lead: <lead id>`. Read the lead with `kanban_show(task_id="<lead id>")`.

## Stages

The stage of a lead is the newest comment on the **lead card** whose first line is exactly:

```
stage: <Stage>
```

followed by an optional reason on the next lines. You may set only:

- `stage: Researched`
- `stage: Proposal Drafted`

(and `stage: Found` if you add a new lead). `Approved`, `Sent`, `Interview`, `Won` and `Lost` belong
to the owner. Ruang ignores them when an agent writes them.

## Research job

1. Use the job text on the lead card first (the owner may paste the job post as a note), then try
   the Upwork URL once (often blocked: write "Not Available"). Never log in.
2. Comment your findings on the lead card (summary, deliverables, application questions, client
   signals, risks, questions, Niche fit, sources), starting with `stage: Researched`.
   Deliverables are what the client wants built or delivered. Application questions are every
   question the post asks applicants, word for word and numbered (or "none"). Niche fit is a 1-5
   score on a fixed scale plus the hard requirements about the freelancer, each marked Met / Not
   shown in freelancer facts / Unknown, judged only against the `freelancer-facts` skill (Not
   Available when it is empty). The comment may name the owner's public tools and skills, never
   the rate, pricing, personal details, project details, links or the never-claim list.
3. Finish your work card with `kanban_complete(summary="<short findings>")`.

## Proposal job

1. Facts about the freelancer only from the `freelancer-facts` skill; `[MISSING: ...]` otherwise.
   Answer every application question from the research comment, in order.
2. Put the full proposal draft in `kanban_complete(summary="<draft>")` on your work card.
3. Comment `stage: Proposal Drafted` on the lead card.
4. Never send anything to Upwork or the client. The owner approves and sends.

## Rules

- No secrets, passwords or API keys in comments or summaries.
- No personal data about the client beyond what the job post shows.
- If you cannot continue, `kanban_block` **your work card** (never the lead) with the reason.
- Facts you are not sure of: say "unknown". Never guess numbers.
