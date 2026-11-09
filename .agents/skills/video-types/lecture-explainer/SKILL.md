---
name: lecture-explainer
description: Defines success and creative/self-review guidance for videos made from an instructor's lecture deck and approved voice-over. Use when students should be able to follow, recall, and distinguish the lecture's key ideas, and the instructor's content and wording are the fixed input.
---

# Lecture Explainer

## Success Definition

After one viewing, a student in the target course should be able to name and distinguish the lecture's key ideas in the instructor's terms, recall the structure that connects them (sequence, comparison, cycle, hierarchy), and recognize the same material when they open the deck. When goals conflict, protect fidelity to the approved narration and the deck's facts first, then the visibility of each idea's structure, then visual polish. A polished lecture video fails when it becomes a slideshow with a voice on top, when on-screen text competes with narration, or when it adds claims, examples or emphasis the instructor did not approve.

### Use when

The fixed input is a course deck plus instructor-approved (or user-approved) narration, and the outcome is learning or review of that lecture's content.

### Do not use as primary when

There is no source deck or approved narration, the goal is one transferable intuition rather than covering a lecture's scope, or the viewer must complete a task.

### Boundary with adjacent profiles

- `concept-explainer` builds one intuition with a transfer test; this profile covers a lecture's approved scope in its approved order and wording.
- `illustrated-explainer` defines a caption/illustration format; select it as supporting only when that format is explicitly requested.
- `technical-explainer` may support a lecture whose core is a causal system model, adding mechanism accuracy without replacing lecture fidelity.

## Creative Guidance

The approved narration is the spine. Do not rewrite it for style; tighten only where the user asks. Treat each narration segment as one teaching unit with one visible structure: a comparison, a list that accumulates, a cycle, a timeline, a board, a quadrant, a map.

Keep the lecture's own vocabulary on screen. Visible anchors are short terms or phrases taken from the slide or narration (names, numbers with units, headline terms), not new summaries. Where the lecture has a recurring structure (a list of practices, a process board), keep it recognizable across segments so students can locate each part in the whole.

Chapter structure should mirror the deck's sections. Opening and closing beats may frame the lecture (what you will learn, where the methods apply) using only approved narration.

Reuse follows the slide assessment (`.agents/skills/lecture-slides/SKILL.md`): reuse the instructor's strong, licensable graphics; rebuild illegible or unlicensable ones from the same facts; never reuse material marked unknown-licence.

## Self-review Guidance

Ask:

- Is every narrated sentence present, unchanged, and in approved order?
- Does each scene's visible structure match the relationship the narration states?
- Are all on-screen terms traceable to the deck or narration?
- Do screen anchors complement speech instead of transcribing it?
- Is any fact, number, name or attribution altered or unsupported by the deck?
- Would a student recognize where each scene sits in the lecture's chapter structure?
- Does anything on screen change when the narration introduces a new idea?
- Are required licence credits visible while licensed material is shown?

Disqualify unapproved narration changes, factual drift from the deck, reuse of unlicensed third-party material, and scenes whose visual contradicts or ignores the narrated structure. Accept simple, literal visuals and the lecture's own terminology; do not demand hooks, stories, or a CTA the lecture does not have.

## Development Guidance

Map one narration segment to one canonical scene by default, putting the exact approved segment text in `audio.voiceoverText`. Split only at sentence boundaries when a segment carries two separate structures, keeping the words unchanged. Put the lecture's key terms in `screenText`, and in `visualConcept` state the structure the viewer must perceive and which slide facts it carries. Use measured TTS durations plus breathing margin for scene budgets. Chapter title cards are silent scenes only if the approved narration leaves room; otherwise chapter identity rides on the first scene of each chapter.

## Renderer Guidance

Reveal each structure in step with the narration: items appear, highlight, or move when they are spoken, and the full structure is visible by the end of the segment. Keep a consistent chapter marker so students always know which section they are in. Reused slide graphics are framed on the themed canvas at native aspect, enlarged for legibility, and animated by reveal, focus or highlight rather than distortion. Keep text sizes at or above the lecture legibility threshold (28 px at 1080p for body text). Avoid constant motion that competes with listening.
