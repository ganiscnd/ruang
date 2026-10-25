---
name: leads-protocol
description: How to research an Upwork lead or draft a proposal for it on the Kanban board "leads" (Ruang Mission Control). Load for every card whose title starts with "[lead ".
version: 1.2.0
metadata:
  hermes:
    tags: [kanban, leads, upwork, proposals]
    category: freelance
---

# Leads protocol (board `leads`)

Ruang (the owner's Mission Control) creates your work card. This skill is the full set of rules.
If anything here conflicts with a wish to "be helpful", these rules win.

## When to Use

Your Kanban card's title starts with `[lead <lead id>] Research:` or `[lead <lead id>] Draft proposal:`
and its body starts with `lead: <lead id>`.

## Two cards

- **Your work card**: the card you were assigned. You finish it.
- **The lead card**: `<lead id>`. Read it with `kanban_show(task_id="<lead id>")`. You only ever
  *comment* on it. Never assign, block, archive, complete, edit or link the lead card.

A lead card's body is a `[lead]` block (`client`, `budget`, `upwork_url`, `posted`, `fit`, `tags`),
then `---`, then free notes. The owner's comments on the lead card may hold the pasted job post.

## Allowed tools

- `kanban_show`, `kanban_comment` (on the lead card), `kanban_complete` and `kanban_block` (on
  **your work card** only), `kanban_heartbeat`.
- `web_search` / `web_extract` for public information.
- Never use: `kanban_create`, `kanban_link`, `kanban_request_review`, `kanban_request_changes`,
  `kanban_schedule`, `kanban_unblock`. Finish with `kanban_complete`, never with a review request.

## Stages

The lead's stage is the newest comment on the lead card whose **first line** is exactly
`stage: <Stage>`. Agents may write only `stage: Researched` and `stage: Proposal Drafted`.
`Approved`, `Sent`, `Interview`, `Won` and `Lost` belong to the owner; never write them.

## Where the job facts come from

1. First: the job text on the lead card (body notes and the owner's comments).
2. Then: try `web_extract` on `upwork_url` **once**. Upwork often blocks automated readers
   (Cloudflare). If it is blocked or needs a login, write "Upwork page: Not Available (blocked)"
   and continue with what you have. Never try to log in, never retry in a loop.
3. Optional: `web_search` for public facts (a tool's pricing, an API's limits). Name each source.

Never invent facts. Anything you could not read is "unknown". Never guess numbers.

## Procedure: research job

1. `kanban_show` the lead card. Read every comment.
2. Gather facts as above.
3. `kanban_comment` on the **lead card**, in this shape (first line exactly as shown):

   ```
   stage: Researched
   Summary: <2-3 sentences: what the client wants>
   Deliverables: <bullet list: what the client wants built or delivered, from the job text>
   Application questions:
   1. <the client's first question to applicants, word for word>
   2. <...>
   Client signals: <only what the post shows: country, budget, history, or "unknown">
   Risks / red flags: <scope creep, low budget, vague ask, ... or "none found">
   Questions to ask the client: <2-4>
   Niche fit: <N>/5 (agent rating; the owner's own fit value is separate)
   Why: <1-2 lines: which parts of the owner's niche and public tools the job matches or misses>
   Hard requirements:
   - <requirement about the freelancer> → Met (per freelancer facts) | Not shown in freelancer facts | Unknown
   Client deal-breakers: <the post's own "we will not move forward with ..." lines, or "none stated">
   Sources: <job text in comments | Upwork page: read / Not Available | URLs used>
   ```

4. `kanban_complete(summary="<one-paragraph findings>")` on **your work card**.

## Deliverables and application questions (research job)

- **Deliverables** are what the client wants built or delivered: phases, workflows, documents,
  SOPs, training, a Loom walkthrough. Never mark deliverables Met / Not shown / Unknown.
- **Application questions** are every question or instruction the post asks applicants to answer
  or include (for example under "To apply, please answer:", "Start your proposal with ...", or "A
  short Loom ... is a big plus"). Copy each one **word for word**, numbered in the post's order,
  including optional ones. Never shorten, merge or reword them: the proposal writer answers them
  one by one. If the post asks none, write `Application questions: none`. If no job text could be
  read, write `Application questions: Unknown (job text not available)`.

## Niche fit (research job)

Judge the job against the **Niche** and **Proof I can show** sections of the `freelancer-facts`
skill. If that skill is missing, or those sections are empty or "none", write exactly
`Niche fit: Not Available (freelancer facts not filled in)`, still list the hard requirements, and
mark each one "Unknown". Never guess the owner's niche or skills.

Score with this fixed scale (pick the highest line that fully applies):

| Score | Meaning |
|---|---|
| 5 | Construction / AEC work that uses the owner's core stack |
| 4 | The core stack in an adjacent field (engineering, real estate, field services, document-heavy B2B) |
| 3 | The core stack in an unrelated industry |
| 2 | Automation work outside the core stack (for example marketing-CRM funnels, VA-style automation) |
| 1 | Not automation work |

Hard requirements are what the client requires **about the freelancer**: the post's "must have"
and "required" experience, skills and proof (including "to apply, link ..." proof), the
"we will not move forward with ..." lines, and any stated timezone, hours, language or
certification requirement. Deliverables are not hard requirements. Mark a requirement **Met** only
when the freelancer facts say so explicitly (for example "n8n: 3 portfolio links"). Otherwise
write "Not shown in freelancer facts". Never claim the owner has something.

Privacy: the comment may name the owner's public tools and skills (the facts' Core stack and Other
tools; they are on the owner's public profiles) to explain Niche fit. It must **never** include
the owner's rate, prices or pricing rules, personal details (education, work history, location,
timezone, availability, Upwork profile stats), project names or details, links, or anything from
the never-claim list. For those, say only Met / Not shown / Unknown.

## Procedure: proposal job

1. `kanban_show` the lead card. Use its research comment and the job text.
2. Facts about the freelancer come **only** from the `freelancer-facts` skill. If a fact you need
   is missing there, write `[MISSING: <what>]` in the draft instead of inventing it.
   Answer **every** application question listed in the research comment, in its order. If the
   research comment has none and the job text shows some, answer those.
3. `kanban_complete(summary="<the full proposal draft>")` on **your work card**.
4. `kanban_comment` on the lead card: first line `stage: Proposal Drafted`, then one line saying the
   draft is in work card `<your card id>`.
5. Never send, submit or post anything to Upwork, the client, or anyone else. The owner approves
   and sends.

## Pitfalls

- No secrets, passwords, tokens or API keys in comments or summaries.
- No personal data about the client beyond what the job post shows.
- If you cannot continue (no job text and the page is blocked is **not** a reason: report what you
  have), call `kanban_block` on **your work card** with the reason. Never block the lead card.
- Do not save memories or create skills from lead content.

## Verification

- The lead card has exactly one new comment from you, with the correct first line.
- Your work card is completed with `kanban_complete`.
- You created no cards and changed no other card.
