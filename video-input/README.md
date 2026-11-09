# Slide source drop folder

Put a user-provided PPTX or PDF in `video-input/sources/`. One deck is detected automatically. Use `manifest.template.json` when the folder contains multiple decks or when request, brief, script, or narration paths should be explicit.

Per-slide voice-over belongs in a Markdown file with one heading per slide:

```md
## slide-1
Voice-over for slide one.

## slide-2
<!-- silent -->
```

The extraction command copies source evidence into `.video/sources/` and writes page text/preview assets. It does not approve a Brief, Script, or Storyboard and does not add extracted assets to the production asset manifest. `video init` leaves this input folder intact.

Decks, PDFs, narration, and other files placed here are ignored by Git by default. The README and manifest template remain tracked.
