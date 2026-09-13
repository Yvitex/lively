# Meta: reusable prompt — "atomic, testable steps" standard

This file is not part of the Lively build sequence (it is not numbered, and nothing in `01`–`07` depends on it). It exists so you can carry your instructional-guide standard into a **new, unrelated project** without having to re-explain it from scratch or re-trigger it by getting angry again.

## How to use it

At the start of a new project, paste the block below into the chat. Claude will save it as a `feedback` memory scoped to that new project's own memory folder — it does not travel automatically; each project needs this pasted once.

## The prompt

```text
Before you write any instructional or how-to markdown guide in this project (a build guide, a setup walkthrough, an onboarding doc, anything under a folder like instruct/ or docs/), save this as a feedback memory first, then follow it every time such a guide is requested:

Structure the guide as a sequence of atomic, testable steps — never as a dump of complete files grouped by filename.

Each step must:
1. Be one small, self-contained unit of work. If a file does several unrelated things, split it across multiple steps instead of dumping the whole file at once.
2. End with something I can actually run to verify that specific step worked — compile, a unit test, a curl call, a DB query — before moving to the next step.
3. Read as an executable sequence, not a reference I have to mentally reassemble from file-shaped chunks.

The rule that matters most and is easiest to get wrong: any file that wires multiple already-built pieces together (a main/entrypoint file, a top-level orchestrator, a Server Action file several routes contribute to) must itself be built incrementally, interleaved with the steps for the pieces it depends on. Never defer it to one final "now assemble everything" step, even if every individual piece leading up to it got its own verify step.

Concretely: write a minimal skeleton of that wiring file first (e.g. just load config, verify it runs) → the moment the next dependency exists, come back and add just those few lines (show it as a diff or a short addition, not the whole file again) → verify again (run it, see the new behavior) → repeat for each subsequent piece → only at the very end, optionally, show the fully-assembled file as a reference listing.

This also applies inside a single file that does multiple distinct things (type/interface definitions, then pure helper functions each with their own tiny test, then an orchestrating method last) — split by concern and verify each piece, don't write it all in one block.

Before drafting such a guide, identify every file in it that integrates multiple other pieces, and explicitly plan its incremental growth across steps first — don't default to "write the finished file, verify once."
```

## Why this file exists

The standard above was established in two other projects (`lively-backend`, then `lively`) only after guides that dumped whole files — including one giant "now assemble everything" wiring step — were rejected, the second time angrily. Pasting the prompt above at the *start* of a new project is cheaper than re-deriving the rule the same way again.
