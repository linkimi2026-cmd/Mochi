# Mochi Presentations

`mochi-presentations` turns an already authorized structured lesson plan into a real, editable `.pptx`. The primary artifact is PowerPoint: text is a text object, tables use `a:tbl`, and charts use native Office chart OOXML plus an embedded editable worksheet. It never substitutes a page screenshot or HTML page for a PowerPoint file.

`presentation.pdf` is a searchable handout laid out separately from the same structured input. For chart slides it preserves a textual data summary, not a visual chart preview. When LibreOffice is available, `presentation-preview.pdf` is converted from the final PPTX and returned separately so teachers can review the actual slide layout in the built-in PDF viewer. The manifest records `preview.previewOfPptxSha256`, renderer, status, and preview file metadata. If conversion is unavailable or fails, `previewPdf` is null and the handout is never presented as a PPTX preview.

In teacher chat, successful `mochi_ppt_create` and `mochi_ppt_revise` results show buttons to open the converted preview PDF (when present) and editable PPTX through the DSH tool-view `openFile` callback. The callback keeps the Host's workspace access rules; the card does not grant broader filesystem access. A preview button only means a converted PDF is available, not that PowerPoint/WPS rendering has been verified.

## Lesson-plan contract

`mochi-lesson-presentation-v1` accepts 1–40 slides with optional source declarations. A slide is one of:

- `title-body`: a title and 1–6 projection-readable bullets.
- `title-table`: a title, short context bullets, and an editable 2–5 column table.
- `title-chart`: a title, short context bullets, and an editable `bar`, `line`, or `pie` chart with 2–8 labels and 1–3 series (pie has one series).
- `title-compare`: optional short context and two titled columns containing 2–4 aligned row pairs. Each cell is limited to two projection lines and uses a native editable text object in a bounded card; it is intended for direct comparisons such as two concepts, conditions, or before/after states.

Classroom decks may also declare an optional `teachingPlan` in source JSON:

```js
{
  objectives: [{ id: 'observe', statement: '用观察记录描述水的状态变化' }],
  slideMappings: [{
    slideId: 'slide-1', objectiveIds: ['observe'], role: '探究练习',
    studentAction: '标记现象发生的位置', understandingCheck: '学生能用记录指出变化前后的状态',
  }],
}
```

The chat tool returns a `quality.teachingCoverage` declaration report with `not-declared`, `incomplete`, or `mapped` status and concrete hints. A complete status means only that every declared objective is referenced by a page and has an associated understanding check, the plan declares at least one student action, and every explicitly mapped page has a role. Unmapped pages such as covers or section dividers remain listed as informational hints and do not make coverage incomplete. The report does not evaluate pedagogical quality, academic accuracy, or learning outcomes. Generic decks can omit the plan. Mapped pages also place the declared objective statements, page role, student action, and understanding check in the PPTX speaker notes; these declarations are labeled unverified. Revising visible content on a mapped slide retains the plan but marks its speaker notes as requiring review; `newTeachingPlan` replaces the full declaration and clears those review markers. Unmapped and generic pages retain their existing source notes.

Generation computes a deterministic layout budget before writing OOXML: titles may occupy at most two lines; ordinary bullet pages have at most 14 estimated projection lines; table and chart pages have at most three bullet lines; column and axis labels have fixed width budgets. Inputs outside those bounds fail before an output directory is published. This does not rely on PptxGenJS `fit` behavior, which PowerPoint applies dynamically after opening the file.

PPTX text requests `Noto Sans SC`. The macOS/Windows Office application may substitute a locally available CJK font if that face is absent; the direct PDF embeds the bundled Noto Sans SC subset. Font embedding in Office files is not provided by this writer, so a final target-machine Office check remains required for pixel-identical typography.

`revisePresentationBundle` creates a new bundle from `source.json`, updates exactly one named slide, and increments only that slide’s version. It preserves the optional teaching plan by default, recalculates its coverage report, and marks a retained mapping for the revised slide as review-needed when visible content changes. The plugin verifies untouched slide XML against the prior PPTX byte-for-byte. A chart-only update can legitimately leave its slide XML relationship unchanged; in that case the verifier checks the target `ppt/charts/chart*.xml` instead. Each revision renders its own final PPTX preview when LibreOffice is available; it never copies an older preview.

`plugin.mjs` registers:

- `mochi_ppt_create` for new decks, with optional `teachingPlan`, `table`, or `chart` per slide.
- `mochi_ppt_revise` for a specified page, using the returned `sourcePath` and optional `newTitle`, `newBody`, `newTable`, `newChart`, or whole-plan replacement via `newTeachingPlan`.
- `ppt_inspect` to read an existing `.pptx` back as a structured page model (read-only).
- `mochi_ppt_render` to render a generated `.pptx` back to PNG (via LibreOffice → PDF → pdfjs) so the deck can be **visually** checked before delivery. **This is a mandatory step in `mochi_ppt_create`'s tool description**, not an optional extra.

The plugin uses the alpha runtime’s normal root dependency `@deepseek-ai/dsh-tools@0.1.3-alpha.1`; it never imports that API through a sibling plugin’s `node_modules`. `jszip` is a runtime dependency because revision verification and `ppt_inspect` open the PPTX after generation. `@mochi/pdf-layout` (workspace package `packages/mochi-pdf-layout`) is also a **hard runtime dependency** — `index.mjs` imports `drawTextLine` and friends from it; `pdfjs-dist` / `@napi-rs/canvas` are needed by `mochi_ppt_render`. The desktop currently pins `mochi-pdf-layout-0.1.0-c4a3d2c2.tgz`; its installed module exports `drawTextLine`, and the latest resource packaging check passed.

## Reading a deck back (`ppt_inspect`)

`ppt_inspect` opens the package with JSZip and parses the real OOXML parts — `ppt/presentation.xml` (slide order via `p:sldIdLst` → `ppt/_rels/presentation.xml.rels`, and `p:sldSz`), every `ppt/slides/slideN.xml` (text runs, placeholders, geometry, `a:tbl`, chart references), `ppt/slideLayouts/**` (layout name), `ppt/notesSlides/**` (speaker notes), and `docProps/core.xml` + `docProps/app.xml` (title, author, created/modified, declared slide count). It never extracts image binaries; pictures are reported by part name and count.

It is strictly read-only and is not a second writer: slide edits stay in `mochi_ppt_revise`. Paths are resolved with `path.resolve` and must stay inside an allowed root — explicit `allowedRoots` (host/test), `MOCHI_PRESENTATIONS_ROOTS`, or the current session workspace. The user home directory and the filesystem root are never accepted as a root.

Honesty guarantees:

- A file that is not a real PPTX fails loudly: `PPTX_NOT_ZIP` (no ZIP signature / unreadable archive) and `PPTX_NOT_PRESENTATION` (renamed `.docx`/`.xlsx`, detected from `[Content_Types].xml`, or a package without `ppt/presentation.xml`). It never reports “0 slides” for a renamed document.
- `PPTX_TOO_LARGE` above 64 MiB (and above 16 MiB for any single part) and `PPTX_TOO_MANY_SLIDES` above 200 slides are reported as limits, not silently truncated.
- When a shape carries no `p:ph` placeholder type (PptxGenJS and many exporters omit it), the title/body role is a disclosed heuristic over position and font size, and the `角色判定` field states the basis. The placeholder type itself is always reported verbatim when present.
- A renamed `ppt.inspect` reference in the skills layer is registered here as `ppt_inspect`; the skill file is updated by the toolchain owner, not by this plugin.

## Teaching sample and checks

`fixtures/teacher-lesson.mjs` provides a seven-slide, editable Grade 7 water-cycle and water-conservation lesson. It declares two learning objectives and six mapped teaching pages, leaving the cover unmapped. It uses paired activity rows for observation clues and recording methods, a native process diagram, a table, a chart, paired action-design and completion criteria, and a closing question. Its poll values are explicitly marked as classroom discussion example data, not records about a real class; the observation activity refers to the following simplified path diagram rather than an absent figure.

```sh
node fixtures/generate-teacher-sample.mjs /absolute/new-output-directory
npm test
MOCHI_PRESENTATIONS_PLUGIN_URL=/absolute/Resources/mochi/plugins/mochi-presentations/plugin.mjs node test-plugin.mjs
```

The first command emits `presentation.pptx`, `presentation.pdf`, `source.json`, and `manifest.json`; it also emits `presentation-preview.pdf` when LibreOffice successfully converts the final PPTX. The unit suite opens the PPTX with JSZip, checks native editable table/chart OOXML and the embedded chart workbook, validates bounded layout rejection, and proves targeted revision preserves untouched slides. When LibreOffice is installed, it also checks preview PDF page count, visible revised text, and source/preview hashes. The staged-plugin command is intentionally run from the packaged resource path so the bare `@deepseek-ai/dsh-tools` import resolves through the alpha runtime root `Resources/mochi/node_modules`.

`manifest.quality` records an objective structure check against the final PPTX bytes and SHA-256. It blocks page-count and clearly undersized text-shape failures and hints when three consecutive pages use `title-body`. When present, `quality.teachingCoverage` audits only declared plan fields and reference completeness; it does not certify lesson quality. The inspector reports each shape's largest run size; a passing font check cannot prove that every run is large enough. `quality.status: needs-visual-review` remains until someone actually views the latest rendered deck. A generated preview and a passing structure check do not certify visual quality or subject accuracy.

## Reuse decision (2026-09-08)

- Adopted: [PptxGenJS v4.0.1, tag `3c9ec1b`](https://github.com/gitbrent/PptxGenJS/releases/tag/v4.0.1), MIT. It is the installed current release and supplies the native editable text, table, chart, and OOXML writer needed here; no version change is justified.
- Partially adopted as a design reference: [siril9/presentation-skill](https://github.com/siril9/presentation-skill), MIT. Its source-first outline, native chart/table, and visual-QA concepts fit this module; its Python/LibreOffice-oriented stack is not imported.
- Not adopted: [Presenton](https://github.com/presenton/presenton), Apache-2.0, and [pptx-gen](https://github.com/alfonsograziano/pptx-gen), MIT. Presenton now also has a desktop route, but adopting either would replace the existing generated/edit/packaging chain without a verified compatibility benefit for this deadline. `pptx-gen` is also a small, unreleased project. No product defect is inferred from those projects or their issue trackers.

## 流程与循环图

`mochi_ppt_create.slides[].process`与`mochi_ppt_revise.newProcess`接受`{steps:[{label,detail},...],loopLabel?}`，对应`title-process`版式。支持3–4步，label≤10字、detail≤32字，循环返回说明≤32字；bullets为空或最多1条40字说明。步骤不能同时携带table/chart。普通顺序省略loopLabel；真实循环才画返回箭头。

PPTX用可编辑原生矩形、文字和线箭头，PDF讲义由同一场景几何独立绘制；后者仍不作为PPT视觉验收证据。修订继承已有sourcePath/全新目录纪律，从流程切回其他版式时清除旧process数据。流程图字段不能控制任意坐标、图片或字号。

`node --test plugins/mochi-presentations/test/process-layout.test.mjs`验证生成、语义完整、原生箭头、四步修订、布局退出和未改页保持。
