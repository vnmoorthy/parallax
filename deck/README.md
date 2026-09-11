# Parallax pitch deck

Ten slides, 16:9, dark theme matching the product. Built for the Data & AI Hackathon ("Real job. Real AI. Real scale."), AWS Builder Loft, San Francisco, September 11, 2026.

| File | What it is |
|---|---|
| `Parallax.pptx` | The deck (10 slides, 10 in × 5.625 in, speaker notes on every slide) |
| `STORYBOARD.md` | The 3-minute talk track: per-slide timing, exact words, what to click, one-line answers |
| `thumbnails/slide-NN.png` | One PNG per slide, rendered from the .pptx with LibreOffice |
| `generator/` | The pptxgenjs script that produced the deck (see "Regenerate") |

## Open and present

- **Keynote / PowerPoint (macOS):** double-click `Parallax.pptx`. Fonts are Helvetica (text) and Menlo (code), both system fonts on macOS, so nothing substitutes. On Windows PowerPoint they fall back to Arial and Consolas; layout holds.
- **LibreOffice:** `soffice Parallax.pptx` renders identically to the thumbnails.
- **Speaker notes:** every slide carries notes (View → Notes / Presenter View). The full script with timings is `STORYBOARD.md`; the notes are its condensed version.
- **Slide 4 is a live demo.** Keep the app running in a second window (`make dev` with keys, or `make demo` with none) and switch to it when you reach that slide. Pre-flight checklist and fallbacks are in `STORYBOARD.md` and [`../docs/DEMO.md`](../docs/DEMO.md).
- Total talk time is 180 s: 20 s opener (slide 1), 15 s close (slide 10), 40 s on the demo.

## Slide list

| # | Title | Content |
|---|---|---|
| 1 | Parallax · Many agents. Many branches. One answer. | Wordmark, fork art, event line, presenter, repo |
| 2 | One analyst. One query. One hypothesis at a time. | The demo question as eight serial questions; three pains |
| 3 | Fork the database per hypothesis. | Root → forks → report → memory strip; Fork / Explore / Synthesize / Remember |
| 4 | Mission Control: watch the swarm run. | Annotated `mission-control-saas.png` (real 5-agent Ollama run): metrics strip, lineage tree, agent cards, cited report |
| 5 | Every cloud piece has a zero-key local twin. | Architecture diagram; SSE UI, DataEngine, LLM router, Memory |
| 6 | Many agents, many forks, no contention. | Hotdata: fork tree with SQL / BM25 / VECTOR / MIXED branches; burst 100 reads → p50 15 ms, p95 30 ms, 50 in-flight |
| 7 | The analyst is a pipeline. Nothing to host. | RocketRide: `parallax-analyst.pipe` node graph; `parallax-llm.pipe`; Cloud URI |
| 8 | Cognee remembers. Snyk watches. | Memory page, recall → plan → remember loop; Snyk in CI + read-only SQL guard |
| 9 | Measured, not claimed. | Number tiles (15/30 ms, 110 queries, 1.2 s, 65 tests, 6,102 real listings); zero-key mode; what's next |
| 10 | Try it in three commands. | `git clone` · `make setup` · `make demo`; team; sponsors |

Every number on the slides comes from real local runs on September 11, 2026 (see `docs/JUDGES.md` for how to reproduce each one).

## Regenerate

The deck is generated, not hand-edited. From `generator/`:

```bash
npm install pptxgenjs sharp react react-dom react-icons
node prep_assets.js   # crops brand art + screenshots from ../docs/assets into generator/assets/
node build.js         # writes ../Parallax.pptx
```

Thumbnails: `soffice --headless --convert-to pdf Parallax.pptx && pdftoppm -png -r 150 Parallax.pdf thumbnails/slide` (1500 × 844 px each).

Word budget: every content slide (2–9) carries at most 30 words besides its title; slides 1 and 10 are the only text-heavier ones by design.

Source imagery lives in `../docs/assets/` (`banner.svg`, `architecture.png`, `screenshots/*.png`); edit those, re-run the two scripts, and the deck follows.
