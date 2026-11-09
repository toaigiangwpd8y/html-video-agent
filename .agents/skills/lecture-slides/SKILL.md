---
name: lecture-slides
description: Turn a lecture deck (PDF or PPTX) plus a slide-labeled voice-over script into normalized evidence, a per-slide assessment, and asset-reuse rules for the agent-video workflow. Use whenever a video request supplies presentation slides, lecture notes as a deck, or a slide-by-slide narration script.
---

# Lecture slides → video

This skill supplements `$agent-video`. It adds no checkpoint, no canonical field, and no new approval. It tells you how to read a deck, judge each slide, and decide what the video may reuse. The HITL flow, `video.json` ownership, and Storyboard Enhance authority are unchanged.

## Inputs

The fixed input is **slides + voice-over script**:

- the deck: a `.pdf` or `.pptx` the user supplied (for example under `video-input/sources/<deck>/`);
- the script: Markdown with one section per slide or slide range, as documented in `README.md` ("Slide-deck sources"). Every non-hidden slide is either narrated or marked `[skip]` with a reason. Lines starting with `>` are author notes.

If the user supplies a deck without a script, the normal Script stage writes the narration; still extract and assess the deck first. If several decks are present and the request does not say which, ask through the clarification checkpoint.

`video-input/` is git-ignored because decks are usually copyrighted course material. Never commit a deck, its renders, or its script.

## Step 1 — normalize (deterministic)

```bash
npm run video -- sources extract <deck.pdf|deck.pptx> --id <deck-id>
npm run video -- sources script <deck-id> <script.md>
npm run video -- sources assess template <deck-id>
```

This writes `.video/sources/<deck-id>/` (see `README.md` for the full layout). Read, in order:

1. `deck.json`: slide count, aspect ratio, per-slide `wordCount`, `imageCount`, `minFontPxAt1080`, image catalog (`chrome` = repeated logo);
2. `overview/contact-*.png`: every slide at a glance;
3. `narration.json`: which slides are narrated together and which are skipped;
4. for each narrated slide: `slides/slide-NNN.png` when the contact sheet is not enough, and `slides/slide-NNN.json` for text blocks, bounds and images.

`video init` keeps `.video/sources/`, so extraction can happen before or after init.

Known extraction limits to account for while judging:

- PDF vector artwork (drawn diagrams, SmartArt exported to PDF) is not a separate asset. Cut it from the render with `video sources crop <deck-id> <slide> <x> <y> <w> <h> <name>` (slide points, the same space as the JSON bounds).
- Text inside raster images is not OCR'd, so `minFontPxAt1080` ignores it. Look at the render for charts, screenshots and diagrams that are images.
- Reading order in `text/*.txt` interleaves labels on multi-column diagrams; use the JSON bounds.

## Step 2 — assess every slide

Copy `assessment.template.json` to `assessment.json`, fill the judgment fields, then run:

```bash
npm run video -- sources assess check <deck-id>
```

The check enforces coverage, enums, one-line reasons, file existence, licence rules, and consistency with `narration.json`. Fix every error; explain every legibility override in `legibility.note`.

### Rubric

**Legibility at 1080p.** Assume the whole slide is fit to the 1080 px frame height. The smallest text is `minFontPxAt1080` for text-layer text; estimate raster text from the render.

| rating | smallest text | meaning |
| --- | --- | --- |
| good | >= 28 px | readable on a laptop at normal viewing distance |
| marginal | 20-27 px | readable only if held on screen and not competing with motion |
| poor | < 20 px | unreadable in video; the content must be re-set or enlarged |

**Quality of expression** (how well the slide communicates by itself):

- `strong`: one clear idea or structure (comparison, cycle, sequence, grid) that a viewer grasps in a few seconds;
- `adequate`: correct but list-shaped; the structure lives in the words, not the layout;
- `weak`: wall of text, fragmented labels, decorative imagery doing no work, or a structure the layout hides.

Issue tags: `wall-of-text` (about 55+ body words), `small-text`, `fragmented-labels`, plus any specific problem you see. The template's tags are heuristics from word counts and block geometry: confirm or remove each one against the render. A `strong` rating cannot carry `wall-of-text` or `fragmented-labels` (the check rejects it); `small-text` is a legibility issue and may coexist with `strong`.

**Decision** — pick the cheapest treatment that fully serves the viewer:

| decision | use when | what reaches the screen |
| --- | --- | --- |
| `keep-whole` | the full slide is legible (good), strong, free of classroom chrome that would confuse a viewer, and its layout carries meaning | the slide render, framed |
| `crop-elements` | one element (diagram, photo, chart, infographic) is strong and licensable, the rest is chrome or text | the crop or embedded image, larger than on the slide |
| `rebuild-animated` | the slide has a real structure (comparison, cycle, sequence, state change, chart) that motion would reveal better, or the element is illegible or unlicensable | a themed rebuild of the same facts |
| `text-only` | list-shaped or wall-of-text slides, decorative-only imagery | nothing from the slide; its words feed Script/Storyboard anchors |
| `omit` | the approved script skips the slide | nothing |

Decide per slide, but think per narration segment: a merged segment usually needs one visual idea, so several `text-only` slides can feed one rebuilt scene.

**Reusable assets.** List every extracted file you would put on screen, plus files kept only as factual reference (`use: "reference-only"`). Record a licence for each:

- `course-deck`: the instructor's own slide text, layout and drawn diagrams, supplied by the user. Attribution required (deck title and author).
- A caption on the slide (for example "This Photo by Unknown Author is licensed under CC BY") gives the licence id and attribution text. Encode restrictions in `constraints`: `attribution-required`, `no-derivatives`, `non-commercial`.
- No caption on a third-party photo, clip art, cartoon, stock image or web illustration: licence `unknown`. It cannot appear on screen; list it in `rejectedAssets` or as `reference-only`.

Reuse rules the check enforces:

- `no-derivatives` assets may be shown only whole and unmodified with attribution; never crop, recolor, annotate over, or partially animate them. Rebuilding the same facts in original geometry is allowed and usually better.
- `attribution-required` assets need attribution text, and that credit must appear on screen while the asset is shown (canonical `screenText` or a credit the Storyboard approves). For `course-deck` graphics a short, consistent caption is enough (for example "Graphic: LN04 Agile Methods, N. V. Vu"); the full deck credit (title, author, adapted sources) belongs in the closing.
- `keep-whole` needs the slide render listed as reusable; `crop-elements` needs a crop or embedded image.
- Template chrome (logos, dates, page numbers, repeated banners) is never reused.

Write `reason` as one line a reviewer can check against the slide.

## Step 3 — carry the assessment through the normal flow

- **Clarification:** the deck and approved script usually make the request clear. Record the deck path, script path, audience and target duration as `USER_EXPLICIT` or `CONTEXT_INFERRED`.
- **Video Brief:** reflect the lecture's scope, audience, learning outcome, duration, and the segment structure from `narration.json`. When you surface the Brief checkpoint, include the assessment summary (decision/legibility counts, reused assets with licences, notable rebuilds) and point to `assessment.json`. The Brief stays capability-level: do not assign manifestations to beats.
- **Production profile:** `lecture-explainer` is the natural primary profile when the fixed input is an instructor's deck and approved narration.
- **Script:** preserve the approved per-slide narration wording exactly. One canonical Script beat per narration segment is the default; split a long segment only at sentence boundaries without changing words. Script-stage TTS materializes each beat as usual.
- **Storyboard:** `visualConcept` states what the viewer must perceive from the slide facts. When a scene relies on a reused asset because its identity matters (the instructor's own diagram, a credited photo), say so semantically ("the lecture's own roles infographic", "the credited rugby scrum photo"), and keep the attribution in `screenText` when on-screen credit is required.
- **Storyboard Enhance:** read `assessment.json` in Phase 2. Only assets listed as reusable (not `reference-only`) may be registered in `assets/manifest.json`; copy them from `.video/sources/<deck-id>/` into `assets/`, and record the slide number, deck id, and licence in the registry entry's source/provenance. Everything marked `rebuild-animated` is authored from the extracted text and bounds, not from the slide image.

## Framing 4:3 slide imagery in 16:9

- Never stretch or crop a slide to fill 16:9.
- A `keep-whole` slide sits on the themed canvas, fit to at most 1440x1080 (full height) or a smaller framed card when the scene needs space for anchors; the side area carries the scene's anchor text or stays quiet.
- Crops and embedded images keep their native aspect; enlarge them until the smallest text reaches the `good` threshold or the element fills its layout region.
- Photos with licence captions keep their credit legible while on screen.
- Slide graphics usually have white or near-white backgrounds and colours chosen for a white page. Decide the theme with that in mind at Storyboard time: either a light canvas (`meta.theme.mode: "light"`) where the graphic sits naturally, or a deliberate light card with generous padding and a consistent frame treatment. Never drop white rectangles onto a dark canvas.

## Frame and legibility rules (for Enhance)

Lessons from the LN04 visual reviews. Check each one on begin/middle/end stills of every scene before asking for review:

- **Fill and balance the 16:9 frame.** Scale compositions to the 1920x1080 safe area. Don't park content top-left and leave the lower half empty; a sparse chapter-title beat is the only exception.
- **Teaching labels at 28 px or more** at 1080p: diagram labels, captions and anchors. Headlines should be much larger. A purely secondary locator (such as a progress list) may go down to about 24 px.
- **Size reused-graphic cards by their internal text**, not by a share of the frame. Scale the card until the graphic's own body text is about 28 px or more. For example, a 216 DPI crop whose text is 42 px needs about 0.67x, so the card ends up about 1,250-1,700 px wide. Put headings and lists beside the card, not above it.
- **Zooms never clip labels.** Give each camera focus its own zoom level so the station being spoken fits whole. Fade out any station or label that is not fully inside the view rather than cutting it mid-word.
- **Nothing partly off-frame during a hold.** Prefer a composition where both stations are on screen and attention moves by dimming, rather than a pan that leaves sliced elements.
- **A strong first second.** At 0.5 s the frame must already carry the title or the scene's core contrast at full size. Draw or ghost the structure being described instead of starting with a small element.
- **Show benefits and outcomes on the recurring object.** For example, a WIP-limited board keeps the queue from piling up. Don't use abstract bars or icons.
- **Diagram labels use the lecture's or the narration's words and add no claims.** Close paraphrases are fine. A qualifier the narration doesn't make (such as "not standard Scrum") is a new claim: drop it or patch canonical copy first.

## Anti-slideshow check (for the Enhance self-audit)

A lecture video fails if it is a sequence of slide images with a voice on top. For each scene ask: does something on screen change when the narration introduces a new idea? Reused slide material should be revealed, highlighted, or transformed in step with narration, not held static for the whole segment.
