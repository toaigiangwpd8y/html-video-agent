# Motion rules index

After scene design and asset resolution, compare the candidate layout/blueprint and intended visual behavior against these groups. Load only the matched rule bodies. Multiple groups may be combined when each has a distinct semantic or temporal purpose; do not load every guide by default.

| Pattern group | Match when | Rule body |
| --- | --- | --- |
| Arrival/stagger | Several meaningful elements enter in a readable order, or a new element needs a clear arrival relative to an established composition. | [`patterns/arrival-stagger.md`](patterns/arrival-stagger.md) |
| Travel/hand-off | A semantic object moves through space, crosses a boundary, or transfers identity or focus between regions. | [`patterns/travel-handoff.md`](patterns/travel-handoff.md) |
| Reveal/progressive disclosure | Information, detail, or structure becomes knowable in stages. | [`patterns/progressive-reveal.md`](patterns/progressive-reveal.md) |
| Causal response/anticipation-impact | An action or event should visibly cause a response, with preparation, impact, and consequence. | [`patterns/causal-response.md`](patterns/causal-response.md) |
| Reposition/settle/hold | An established composition changes position or hierarchy and then needs a readable inspection state. | [`patterns/reposition-settle-hold.md`](patterns/reposition-settle-hold.md) |

Pattern selection follows the exact policy:

> Select the motion patterns required to express the intended visual behavior and choreography faithfully. Every selected pattern must have a semantic or temporal purpose. Do not reduce motion richness to minimize the number of patterns. Do not add motion that has no communicative purpose.

These guides are renderer-neutral. Reuse the selected local layout blueprint, including `camera-journey` when cause and consequence occupy regions of one continuous world. Motion guidance cannot create a new scene blueprint or change canonical meaning. Runtime is chosen by capability; the installed official Remotion skills and documentation remain authoritative for implementation technique.

Source lineage: local synthesis informed by temporal progression, semantic-object materialization, and continuity rules in the local HyperFrames blueprint adaptation.
