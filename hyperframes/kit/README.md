# HyperFrames authoring kit

First-party HTML/CSS layout primitives for generated video scenes. The kit has no runtime dependency or remote resource.

## Files

- `tokens.css`: profile-derived colors, font stack, spacing, radius, and motion tokens.
- `primitives.css`: reusable layout and motion rules.
- Each renderer project receives its own `theme.css` from the frozen profile palette/font.

## MVP primitives

- Title/Text: `.hf-title`, `.hf-copy`.
- Fullscreen Media: wrap one local `<img>` or muted `<video>` in `.hf-media-fullscreen`.
- Split Layout: `.hf-split`, `.hf-split__content`, `.hf-split__media`.
- Seekable entrance: `.hf-enter-fade-up`.

Use a semantic blueprint to decide which primitive fits each scene. Keep all visible copy canonical and wrap exact text in the generated `data-canonical-text-id` element. Media paths must refer to project-local, manifest-approved assets.

CSS animations use fixed durations and keyframes so the CLI can seek to any timestamp. Do not add scripts, timers, random values, network resources, or third-party motion packages.
