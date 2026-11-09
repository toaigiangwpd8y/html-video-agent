# SaaS Product Promo Examples

This reference expands the `product-ad` Success Definition and Creative Guidance with optional craft examples. The normative requirements remain in the parent skill. Explicit user style, campaign intent, product truth, claim credibility, and the approved canonical fields stay authoritative.

## Message-led progression

Start with one dominant product or brand message. Choose an opening that makes the relevant audience problem, tension, or opportunity clear and creates a question the product can credibly resolve. Bring the product into that idea early enough that the opening does not feel like unrelated bait.

An adaptable progression is **problem or tension → UI transformation → feature payoff → intended outcome**. It is guidance, not a fixed scene count, hook quota, or required order. A brief may begin with the product, use a contrast, move directly to an outcome, combine beats, or choose another supported persuasive mechanism. Supporting features belong only when they sharpen the dominant message.

Keep the message, the product UI state or transformation, and the intended outcome together in the existing semantic scene fields. Use the canonical `screenText`, `visualConcept`, `audio.voiceoverText`, `meta.theme`, and `meta.constraints` as appropriate; do not introduce a SaaS-ad-specific JSON structure. Every meaningful claim and copy choice must remain canonical.

## UI as the message carrier

Let the interface show why the feature matters. A state change, focused detail, or rearrangement can make a capability legible without turning the spot into a complete walkthrough. UI panels or cards may move, separate, enlarge, and recombine into a clearer layout that expresses the product payoff. A browser frame can establish context when useful, but it is optional; it is not a mandatory container for every shot.

Keep the UI recognizable and grounded in available product evidence. A transformation may simplify or rearrange what is shown, but must not imply a new control, capability, result, or causal step unsupported by the product. If the claim needs workflow evidence, show enough of the relevant action, response, and result to establish the causal point. Do not require every click or a full reproducible workflow unless the brief asks viewers to learn or verify that workflow.

## Kinetic typography and pacing

Use large, concise type to state or reinforce the dominant message. Give each line enough readable time at its actual size, contrast, and motion; speed should not make the claim hard to understand. A scale pop, slide, or overshoot can add emphasis when it lands on a meaningful word or message turn. Settle the movement when needed for reading, and avoid motion that competes with the product UI or obscures its evidence.

Coordinate type and UI around the same message: type can name the benefit while the interface transformation makes its mechanism visible. Let movement and visual rhythm clarify that relationship instead of adding activity without meaning.

## Beat-led transitions and UI asset layers

Use hard cuts, snaps, whips, flashes, or match cuts when they land on a meaningful message turn, action, or product-state change. Choose the transition that clarifies that beat; do not stack every effect into every shot or shake the whole screen on each beat. Match motion intensity to the approved style and preserve a steady, readable product anchor.

Keep a captured screenshot distinct from separately movable UI element layers. A screenshot is a flat record of interface appearance; element layers are independently captured or faithfully derived interface parts. When the composition needs a card to separate from its captured screen, use Storyboard Enhance after approval to resolve an element capture or truthful derivative with provenance through the existing asset manifest and preflight gate. Preserve source labels and relationships, and do not invent interface labels, controls, or capability. A screenshot alone does not prove behavior that was not observed.

Implement the approved `visualConcept`, `screenText`, `meta.theme`, and `meta.constraints` in whichever renderer the brief selected. Remotion or HyperFrames can each support a custom implementation; this guidance does not choose or switch the engine. Keep all meaningful visible and spoken copy in canonical `video.json`, including the exact approved `audio.voiceoverText`.

For the high-energy default, use fast background music under the message and voice. Click, whoosh, and impact sounds can mark selected intentional actions or message turns; keep them sparse enough that they do not compete with speech or product evidence. Music must leave the voice intelligible. Let motion settle into readable holds for important type and UI, at their actual size and contrast. There is no fixed BPM or effect count. Keep brief-approved narration at its approved wording and native speed; adapt scene timing and music around it instead of trimming or speeding up the voiceover. Follow an explicitly quieter sound direction when the brief requests one.

## Feature payoff and closing

Make the feature payoff observable in the UI or in another truthful product representation. Connect that evidence to the audience outcome the campaign promises; do not inflate a local feature effect into a broader performance or business result without support. Evidence can be concise and still persuasive when the causal link is clear.

Close by returning to the dominant message and, when the objective calls for it, a clear next step proportional to what the spot has established. Awareness and consideration may end on a memorable product benefit without a hard sell. Action-oriented work should make its requested response clear and earned.

## Bounded self-review examples

- Can someone summarize the one intended message after one viewing?
- Does the UI transformation make the feature payoff visible, or does the interface only decorate the frame?
- Is there enough truthful cause-and-effect evidence for each material claim, without requiring a full workflow that the campaign does not need?
- Can viewers read each kinetic line at the pace shown? Does type support the UI instead of fighting it?
- Do the visual and sound rhythms reinforce the message and its turns?
- Does the piece still serve the campaign objective, or has it drifted into tutorial steps?
- Does the close leave the intended audience with the promised outcome or a proportionate next step?
