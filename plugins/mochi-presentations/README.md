# Mochi Presentations

`mochi-presentations` turns an already authorized structured lesson plan into a real, editable `.pptx`. The primary artifact is PowerPoint: text is a text object, tables use `a:tbl`, and charts use native Office chart OOXML plus an embedded editable worksheet. It never substitutes a page screenshot or HTML page for a PowerPoint file.

The companion PDF is drawn from the same structured input as a searchable handout. For chart slides it preserves a textual data summary, not a visual chart preview. It is supplementary evidence, not a replacement for the PPTX or a generic PPTX-to-PDF converter; open the PPTX to review and edit the native chart.

## Lesson-plan contract

`mochi-lesson-presentation-v1` accepts 1–40 source-attributed slides. A slide is one of:

- `title-body`: a title and 1–6 projection-readable bullets.
- `title-table`: a title, short context bullets, and an editable 2–5 column table.
- `title-chart`: a title, short context bullets, and an editable `bar`, `line`, or `pie` chart with 2–8 labels and 1–3 series (pie has one series).

Generation computes a deterministic layout budget before writing OOXML: titles may occupy at most two lines; ordinary bullet pages have at most 14 estimated projection lines; table and chart pages have at most three bullet lines; column and axis labels have fixed width budgets. Inputs outside those bounds fail before an output directory is published. This does not rely on PptxGenJS `fit` behavior, which PowerPoint applies dynamically after opening the file.

PPTX text requests `Noto Sans SC`. The macOS/Windows Office application may substitute a locally available CJK font if that face is absent; the direct PDF embeds the bundled Noto Sans SC subset. Font embedding in Office files is not provided by this writer, so a final target-machine Office check remains required for pixel-identical typography.

`revisePresentationBundle` creates a new bundle from `source.json`, updates exactly one named slide, and increments only that slide’s version. Unmodified slide XML is intended to be preserved byte-for-byte. ⚠️ 2026-09-12 audit: `revisePresentationBundle` re-generates the bundle from `source.json` (`index.mjs:657-667`), so this claim is **not currently verified by any test** — treat it as intent, not a guarantee. A chart-only update can legitimately leave its slide XML relationship unchanged; in that case the verifier checks the target `ppt/charts/chart*.xml` instead.

`plugin.mjs` registers:

- `mochi_ppt_create` for new decks, with optional `table` or `chart` per slide.
- `mochi_ppt_revise` for a specified page, using the returned `sourcePath` and optional `newTitle`, `newBody`, `newTable`, or `newChart`.
- `ppt_inspect` to read an existing `.pptx` back as a structured page model (read-only).
- `mochi_ppt_render` to render a generated `.pptx` back to PNG (via LibreOffice → PDF → pdfjs) so the deck can be **visually** checked before delivery. **This is a mandatory step in `mochi_ppt_create`'s tool description**, not an optional extra.

The plugin uses the alpha runtime’s normal root dependency `@deepseek-ai/dsh-tools@0.1.3-alpha.1`; it never imports that API through a sibling plugin’s `node_modules`. `jszip` is a runtime dependency because revision verification and `ppt_inspect` open the PPTX after generation. `@mochi/pdf-layout` (workspace package `packages/mochi-pdf-layout`) is also a **hard runtime dependency** — `index.mjs` imports `drawTextLine` and friends from it; `pdfjs-dist` / `@napi-rs/canvas` are needed by `mochi_ppt_render`. ⚠️ 2026-09-12: the pinned tgz `mochi-pdf-layout-0.1.0-a3f9ed33.tgz` in `vendor/local-plugins/` **does not export `drawTextLine`**, which is why `test-package-resources` currently fails — the tgz must be repacked.

## Reading a deck back (`ppt_inspect`)

`ppt_inspect` opens the package with JSZip and parses the real OOXML parts — `ppt/presentation.xml` (slide order via `p:sldIdLst` → `ppt/_rels/presentation.xml.rels`, and `p:sldSz`), every `ppt/slides/slideN.xml` (text runs, placeholders, geometry, `a:tbl`, chart references), `ppt/slideLayouts/**` (layout name), `ppt/notesSlides/**` (speaker notes), and `docProps/core.xml` + `docProps/app.xml` (title, author, created/modified, declared slide count). It never extracts image binaries; pictures are reported by part name and count.

It is strictly read-only and is not a second writer: slide edits stay in `mochi_ppt_revise`. Paths are resolved with `path.resolve` and must stay inside an allowed root — explicit `allowedRoots` (host/test), `MOCHI_PRESENTATIONS_ROOTS`, or the current session workspace. The user home directory and the filesystem root are never accepted as a root.

Honesty guarantees:

- A file that is not a real PPTX fails loudly: `PPTX_NOT_ZIP` (no ZIP signature / unreadable archive) and `PPTX_NOT_PRESENTATION` (renamed `.docx`/`.xlsx`, detected from `[Content_Types].xml`, or a package without `ppt/presentation.xml`). It never reports “0 slides” for a renamed document.
- `PPTX_TOO_LARGE` above 64 MiB (and above 16 MiB for any single part) and `PPTX_TOO_MANY_SLIDES` above 200 slides are reported as limits, not silently truncated.
- When a shape carries no `p:ph` placeholder type (PptxGenJS and many exporters omit it), the title/body role is a disclosed heuristic over position and font size, and the `角色判定` field states the basis. The placeholder type itself is always reported verbatim when present.
- A renamed `ppt.inspect` reference in the skills layer is registered here as `ppt_inspect`; the skill file is updated by the toolchain owner, not by this plugin.

## Teaching sample and checks

`fixtures/teacher-lesson.mjs` provides a six-slide, editable Grade 7 water-cycle and water-conservation lesson. Its poll values are explicitly marked as classroom discussion example data, not records about a real class.

```sh
node fixtures/generate-teacher-sample.mjs /absolute/new-output-directory
npm test
MOCHI_PRESENTATIONS_PLUGIN_URL=/absolute/Resources/mochi/plugins/mochi-presentations/plugin.mjs node test-plugin.mjs
```

The first command emits `presentation.pptx`, `presentation.pdf`, `source.json`, and `manifest.json`. The unit suite opens the PPTX with JSZip, checks native editable table/chart OOXML and the embedded chart workbook, validates bounded layout rejection, and proves targeted revision preserves untouched slides. The staged-plugin command is intentionally run from the packaged resource path so the bare `@deepseek-ai/dsh-tools` import resolves through the alpha runtime root `Resources/mochi/node_modules`.

## Reuse decision (2026-09-08)

- Adopted: [PptxGenJS v4.0.1, tag `3c9ec1b`](https://github.com/gitbrent/PptxGenJS/releases/tag/v4.0.1), MIT. It is the installed current release and supplies the native editable text, table, chart, and OOXML writer needed here; no version change is justified.
- Partially adopted as a design reference: [siril9/presentation-skill](https://github.com/siril9/presentation-skill), MIT. Its source-first outline, native chart/table, and visual-QA concepts fit this module; its Python/LibreOffice-oriented stack is not imported.
- Not adopted: [Presenton](https://github.com/presenton/presenton), Apache-2.0, and [pptx-gen](https://github.com/alfonsograziano/pptx-gen), MIT. Presenton now also has a desktop route, but adopting either would replace the existing generated/edit/packaging chain without a verified compatibility benefit for this deadline. `pptx-gen` is also a small, unreleased project. No product defect is inferred from those projects or their issue trackers.
