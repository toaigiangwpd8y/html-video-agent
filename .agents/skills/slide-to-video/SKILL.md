---
name: slide-to-video
description: Interpret user-provided PPTX or PDF lesson slides as source evidence for a video, and decide which slide material should be preserved, adapted, rebuilt, or used only as content.
---

# Slide-to-video guidance

Use this only when a request or detected input package contains lesson slides. It supplements the existing Agent Video workflow; it does not create a new agent, checkpoint, plan artifact, or renderer pipeline.

## Read the source before Brief authoring

The source adapter runs before the Video Brief. Read the returned normalized source summary and inspect the files it names:

- one extracted text file per slide/page;
- supplied narration bound to slide IDs, when present;
- a full-slide/page preview for visual inspection;
- parsed element text, bounds, diagram relationships, and embedded-image assets when the format exposes them.

Use only the user-provided attachment or explicit path and the repository-root video-input folder. Do not search unrelated folders or the machine for a likely deck. Extraction records evidence; it does not approve the content or bypass Brief, Script, or Storyboard review.

If multiple supported decks are present without a manifest that selects them, do not guess which one the request means. Ask the smallest clarifying question through the existing clarification checkpoint.

Use the source to understand the lesson's actual subject, learner level, evidence, terminology, and sequence. Do not assume the slide is well-written or visually clear. Treat an included brief as user context that still needs the normal Brief authoring and review. If slide-labeled narration is supplied, preserve its wording in the canonical Script unless the user asks to revise it. If narration is absent, the normal Script stage writes it.

## Judge how each slide should contribute

For each slide, decide internally which representation best serves the approved learning goal:

- **Preserve the full slide** when it is readable at video size and its complete layout carries useful instructional meaning.
- **Crop or reuse selected elements** when a photograph, chart, diagram, or example is clear on its own and should be inspected more closely.
- **Adapt or rebuild the explanation** when the slide is crowded, hard to read, or its relationships need to unfold over time. Keep the source facts and relationships accurate.
- **Use the slide as content evidence only** when its wording is useful for Brief/Script/Storyboard but its visual treatment should not appear in the video.

Do not copy every slide into the video by default. Do not discard a clear visual just to make the video look different. A still source page can be the right choice when the audience needs to read or compare it; otherwise provide a purposeful visual explanation of the same content.

The format adapter's page preview is the complete visual fallback. Parsed text, bounds, and topology can support a faithful rebuild when animation or clarity requires it. Do not infer relationships, labels, or claims that are absent from the source.

## Respect existing ownership and assets

The ordinary Agent Video flow owns the Video Brief, Script, and semantic Storyboard. Storyboard Enhance owns the final scene design, asset selection, and direct Remotion authoring after Storyboard approval. The official Remotion skills remain authoritative for implementation.

Normalized source files under .video/sources are source evidence, not production assets. Materialize a preview or embedded image into assets/manifest.json only after selecting it for a scene and confirming its semantic role. Do not register all extracted files just because they exist.

When several slides teach one connected idea, the Storyboard may combine or split them according to narration and meaning. Do not force one Remotion scene per source slide unless that is the clearest faithful treatment.

## Narration coverage self-check

For every narrated scene derived from slide content, check that the meaningful visual progression covers the spoken explanation. A scene whose entrance animation finishes while substantial narration remains can leave the viewer staring at an irrelevant or static state.

After authoring, inspect the actual Remotion source and sample the rendered scene near its beginning, middle, and end; for a long narration, inspect additional evenly spaced points. Confirm that each important narrated idea has a visible state, example, relationship, or result at the time it is discussed. If a still remains after the key animation, keep it only when reading, comparison, or reflection is the intended beat and the frame continues to support the spoken words. Otherwise extend, sequence, or hold relevant evidence through the narration. Do not add motion that distracts from reading merely to avoid a still frame.

Report only remaining narration-coverage uncertainty in your bounded self-check summary. The mechanical layout verdict comes from `video renderer check`, not from inspecting stills by hand: this remains a bounded correctness check inside Enhance, not a new approval gate or persisted artifact.
