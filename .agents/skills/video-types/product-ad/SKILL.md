---
name: product-ad
description: Defines success and creative/self-review guidance for product or brand advertising. Use when the primary viewer outcome is campaign attention, recall, consideration, or action rather than complete workflow understanding.
---

# Product Ad

## Success Definition

The intended audience should understand and retain the dominant product/brand message and move toward the stated campaign objective: awareness, consideration, action, or another explicit outcome. For software/SaaS campaign ads with no specified style, default to high-energy, product-centered motion that makes the product and its UI carry the message and aid recall. Explicit user style and brief intent take precedence over this default. In every style, preserve product fidelity and claim credibility; energy never justifies invented behavior, results, or proof. When goals conflict, protect objective/message/product fit and claim credibility before novelty or spectacle. A polished ad fails when attention is disconnected from the product, too many messages compete, or the desired response is unsupported by what the viewer saw.

### Use when

The primary job is campaign communication for a product, service, or brand.

### Do not use as primary when

The viewer mainly needs to observe a product workflow, reproduce a task, understand system internals, or decide on a broader proposal.

### Boundary with adjacent profiles

- `product-demo` proves value through observable product behavior; this profile optimizes persuasion, recall, and campaign response.
- `persuasive-pitch` builds an argument for a decision or proposal and need not be advertising.
- A supporting profile may add proof or clarity but cannot displace the campaign objective. Explicit user style remains authoritative.

## Creative Guidance

Identify the campaign objective and audience state before choosing a structure. Select one dominant message/value; supporting features earn space only when they strengthen that message. Define how the product or brand participates in the mechanism rather than appending it after an unrelated opening.

Choose one persuasive mechanism, for example product proof, relevant contrast/reframe, audience situation, credible testimony, offer, story, humor, or intrigue. Use only a mechanism supported by the brief, claims, and user-provided or already-authoritative evidence available at Author time; do not acquire production media before Storyboard approval. Author one complete Script and perform one bounded correctness/fit self-check against this Success Definition. Fix blocking issues in that pass; subsequent revisions follow user feedback.

For software ads, tie material capability or value claims to supported product behavior. When workflow proof is needed, use the known-workflow guidance in `product-demo` without replacing the campaign objective. Preserve the action, response, and result needed to justify the claim even in a short cutdown. Reference videos inform communication and motion choices; their UI, claims, benchmarks, and production stack are not evidence about the advertised product.

For SaaS ads without explicit style direction, favor lively kinetic typography, motion graphics, and purposeful UI movement in service of the campaign message and recall. Use the interface as a product-centered message carrier: a meaningful UI transformation should make the feature payoff legible, while detached or recombined UI elements are optional craft choices. A browser frame is optional. Keep UI behavior recognizable and faithful to available evidence; an explicit calm, minimal, or otherwise different style wins. See [SaaS product promo examples](references/saas-product-promo.md) for optional examples that expand this guidance.

An adaptable default progression may move from a relevant problem or tension, through a meaningful UI transformation and feature payoff, to the intended outcome. Treat this as guidance, not a fixed scene count, hook quota, or required order. Keep each semantic beat's message, UI state or transformation, and intended outcome in existing canonical fields; do not add an ad-specific structure. Make material claims credible with enough causal product evidence to support the message. A promo need not show every click or reproduce a full workflow unless the brief requires that level of proof.

Use existing selected App Explorer workflows when they support the campaign claim. The ad profile never starts exploration automatically; a request to explore must be explicit. Missing workflow knowledge is reported, and any user-authorized exploration preserves unknowns without converting dialog-level observations into claim evidence. Main/supporting video-selection labels describe the requested communication priority only; they do not route exploration or alter App Explorer status.

Keep the opening honest: attention should create the question or need the product message later resolves. Make material benefit, comparison, social-proof, and performance claims supportable. Let directive intensity follow the objective; awareness work may not need a hard sell, while action work needs a clear earned next step.

Use Google's Attention, Branding, Connection, and Direction as a coverage lens, not a scene formula. Interpret connection as audience relevance, not a universal demand for human faces or emotion.

## Self-review Guidance

Ask:

- Does the attention mechanism lead naturally to the product and dominant message?
- Can the intended viewer state the central message after one viewing?
- When the brief or chosen style uses a UI transformation, does it create the feature payoff, or is the interface only decorative background?
- When the brief or chosen style uses kinetic typography, can viewers read it at its intended pace, and does it work with rather than compete against the UI?
- Do visual and sound rhythms reinforce the message and its meaningful turns?
- Is the piece still a campaign ad, or has it become a tutorial without the brief asking for one?
- Is product/brand presence integrated or merely appended?
- Does each material claim have enough truthful causal support in the brief, source, user-provided/pre-existing evidence, or semantic proof to justify the message without implying more than was shown?
- Is audience connection specific rather than generic emotion?
- Is the requested action clear and proportional when the objective requires one?
- Does novelty obscure comprehension, or does conventionality actually fit the brief?
- Is this a noun-swapped generic ad shell?

Disqualify bait-and-switch attention, fabricated benefits, incompatible brand/product portrayal, or an unearned action claim. Accept a calm, literal, low-energy, or CTA-light ad when explicit intent/objective supports it. Do not import demo expectations for a complete reproducible workflow.

## Development Guidance

Preserve the Script's chosen persuasive mechanism. Develop complete copy and semantic beats around one message hierarchy, sharpen the causal product payoff, remove features/claims that do not serve the objective, and resolve whether each material claim is supportable before Storyboard approval; concrete production media remains post-approval.

Map the approved result into canonical `video.json`: campaign copy becomes `screenText` and optional narrated `audio.voiceoverText`; what visibly carries or proves each message becomes `visualConcept`; production media is acquired after approval into `assets/manifest.json`; approved palette/style prohibitions/motion tone become `meta.theme` and `meta.constraints`. Do not add profile-specific hook or CTA objects.

## Renderer Guidance

Maintain a legible product/message anchor and make major visual emphasis coincide with meaningful message turns. For the high-energy SaaS default, use transitions such as hard cuts, snaps, whips, flashes, or match cuts selectively to land on meaningful message or product-state beats; no shot needs every effect, and the whole screen need not shake on every beat. Preserve brand/product recognizability and let energy, density, and rhythm follow the approved brief. Explicit style remains authoritative.

Distinguish a screenshot layer, which preserves a captured interface as one flat image, from UI element layers, whose separately captured or faithfully derived parts can move independently. If a card or control needs to separate from a screenshot, resolve an element capture or truthful derivative with provenance during post-Storyboard-approval asset resolution, using the existing asset manifest and preflight gate. Preserve actual interface labels, controls, and relationships; never invent a capability or label. A screenshot supports appearance, not an unobserved behavior.

Implement motion in the renderer selected at the Video Brief checkpoint; do not switch engines. The selected Remotion or HyperFrames workspace may use custom implementation. Keep meaningful visible and spoken copy canonical in `video.json`: `screenText`, `visualConcept`, `meta.theme`, `meta.constraints`, and `audio.voiceoverText` carry the approved message, visual intent, presentation constraints, and exact brief-approved voiceover. The selected renderer resolves exact timing and implementation structure.

For the high-energy default, favor fast background music, with click, whoosh, or impact SFX used selectively to mark intentional actions or message turns. Keep music and effects clear of the voice, and hold type and interface long enough to read. Do not set a fixed BPM or a sound-effect quota. Preserve the brief-approved voiceover wording and native speed; adapt the music and visual timing to the narration rather than trimming or speeding it up. Explicitly requested quieter sound remains authoritative.
