# Mochi Documents

This local module accepts only already authorized, recognized structured content. The ordinary `generic` template writes a new editable DOCX and draws a PDF directly from that same structure; it does not invoke LibreOffice. It serves the delivery step for teacher-reviewed notices, tables and questions, and does not replace recognition or authorization.

## Components and boundary

| Component | Fixed version / license | Use here |
| --- | --- | --- |
| [dolanmiu/docx](https://github.com/dolanmiu/docx) | `9.7.1`, MIT | Writes editable titles, paragraphs and `w:tbl` tables. |
| [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) | `1.17.1`, MIT | Draws the ordinary PDF from the validated structure. |
| [Hopding/fontkit](https://github.com/Hopding/fontkit) | `@pdf-lib/fontkit@1.1.1`, MIT | Registers the bundled custom font before PDF embedding. |
| Noto Sans SC | bundled variable TTF, SIL OFL-1.1 | Named by the ordinary DOCX and subset-embedded in the PDF. |

The direct renderer handles the bounded generic pages, paragraphs and tables; it is not a general DOCX-to-PDF converter. The Sichuan 2026 exam template remains a separate macOS-only path with its existing Songti SC / Times New Roman requirement and LibreOffice conversion. Its print-layout assertions are intentionally not changed by the generic renderer.

## Teacher deliverables

- `document.docx`: editable text and real Word tables;
- `document.pdf`: a direct, searchable PDF with subset-embedded Noto Sans SC for the ordinary template, or the existing LibreOffice export for the Sichuan template;
- `questions.json`: machine-readable questions and bounded source regions;
- `checklist.json`: structure, editable-file and PDF-path checks;
- `manifest.json`: hashes, `sourcePageCount` and parsed `pdfPageCount`.

## Teacher tool entries

The package entry is `plugin.mjs`. In a teacher runtime profile it registers
six registered tool names through the fixed Alpha `@deepseek-ai/dsh-tools` `defineTool`
contract. Names must stay gateway-safe (`^[a-zA-Z0-9_-]+$`); dotted legacy
historical dotted names such as `doc.create` are not registrable.

| Tool | Writes | Behaviour |
| --- | --- | --- |
| `mochi_document_create` | yes | Existing Alpha contract: validated structured content → editable DOCX + same-source PDF + questions/checklist/manifest in a fresh host-generated directory. |
| `doc_create` | yes | The name the teacher skills reference. Same single implementation as above; only the reported `工具` field differs. There is deliberately no second DOCX generator. |
| `doc_read` | no | Parses `word/document.xml` + `word/styles.xml` into an ordered block model: paragraph text, style id/name, heading level, list marker, real tables (header, rows, merges), image and section counts. Block `序号` is the index `doc_edit` targets. |
| `doc_edit` | yes (new version) | Applies 1–50 explicit paragraph ops (`set_block_text`, `replace_text`, `insert_paragraph`, `delete_block`) and republishes a *new* DOCX. Only affected `w:t` nodes in `word/document.xml` are re-serialised; every other OOXML part is copied from its original compressed bytes. Tables are not re-laid-out and are refused as edit targets. |
| `doc_export` | yes | DOCX → real PDF via the host's local LibreOffice/soffice. The engine is probed first; when absent the tool returns `EXPORT_ENGINE_UNAVAILABLE` with the probed paths and publishes nothing. |
| `pdf_read` | no | Page count, per-page size/rotation/font count/text, document metadata, and an optional `"1-3,5"` page range. See the extraction boundary below. |

`doc_read`, `doc_edit`, `doc_export` and `pdf_read` accept an input path (the
model must be able to name an existing file), but the path is constrained to the
current session's real workspace root: absolute or workspace-relative, an
ordinary non-symlink file, matching extension. Generated output never uses a
model-provided path: `doc_edit` and `doc_export` write into a fresh
`<session workspace>/Mochi Documents/document-<uuid>/` directory.

`doc_edit` reports the real absolute path, real byte count, per-op before/after
text, the list of parts kept verbatim, and a re-read verification (paragraph
texts and block kinds match the intended model, tables unchanged, all other
parts byte-identical). A failed op publishes nothing.

## PDF text extraction: what is actually available

Reading PDF *text* is not something `pdf-lib` can do. This package does not use
`jszip`, HTML, or a page-image stand-in. The implementation is:

- page structure and metadata: `pdf-lib` (`PDFDocument`, `PDFPageLeaf`,
  `PDFArray` content streams);
- page content streams: decompressed through `pdf-lib`'s `decodePDFRawStream`,
  then tokenised locally and decoded for `Tj`/`TJ`/`'`/`"` operations;
- text decoding: the **ToUnicode CMap of each font in that page's resource
  dictionary**. Both `beginbfchar` and the `beginbfrange` single-target and
  target-array forms are parsed;
- document-level fallback: `@mochi/pdf-layout`'s `extractPdfText` (same
  CMap-based boundary, but document-wide, so it can also reach text inside Form
  XObjects).

Honest boundary, reported in every result:

- If a page's fonts provide no usable ToUnicode map **and** its text is not pure
  ASCII single-byte, that page is reported as `unavailable` and the tool returns
  `文本抽取可用: false` with `文本抽取不可用原因`. Nothing is guessed, no OCR is
  run, and no "looks-like-text" value is produced (unmapped codes are surfaced as
  U+FFFD counts).
- Pure-ASCII text without a ToUnicode map is returned and explicitly labelled
  `ascii-during-missing-tounicode`.
- Text inside Form XObjects is only reached through the document-level fallback;
  CID fonts without ToUnicode and OCR of scanned pages are out of scope.

## Host contract

`generateDocumentBundle({ document, outputDirectory, converter, signal })` separates host controls from content:

- `document` must be authorization- and recognition-complete structured content. `sourceKind` is `upstream-authorized-structured-content` or `demonstration`.
- Generic `pages` contain 1–50 bounded pages of headings, paragraphs and tables; `doubts` are structured source regions or explicit unknowns. Invalid values return `INVALID_INPUT`.
- `outputDirectory` is a host-assigned absolute non-existent directory. The module reserves it atomically, stages artifacts privately and publishes each checked artifact without replacement.
- Generic PDFs ignore `converter` and use no external process. The existing converter contract applies only to the Sichuan template: its `sofficePath` is an absolute host configuration and cancellation still terminates the process group with a bounded escalation.

The ordinary PDF verifier opens the generated file with `pdf-lib`, confirms page count and an embedded Unicode font, and reads the generated ToUnicode CMap plus text operations to confirm required titles, paragraphs and table cells remain searchable. It rejects page-image substitutes. A long source page may become multiple PDF pages; the manifest records both counts.

## Sichuan 2026 high-school exam base template

`template: "sichuan-2026-high-school-exam-base"` remains independent of generic documents. It accepts its existing structured exam AST, keeps native OMML and Word table output, and is still verified only on macOS with `/System/Library/Fonts/Supplemental/Songti.ttc` and `/System/Library/Fonts/Supplemental/Times New Roman.ttf`. Missing fonts return `EXAM_FONT_UNAVAILABLE`; no silent replacement is made. Its output remains a product target pending official-sample and physical-print verification.

## Tests

```sh
pnpm install --frozen-lockfile --modules-dir node_modules.nosync
node --test test/*.test.mjs
```

`test/generator.test.mjs` opens DOCX with the plugin's own ZIP reader instead of
`jszip`: `jszip` is a devDependency that this checkout's production install does
not link, so importing it aborted the suite. `test/document-io.test.mjs`
cross-checks that reader/writer against the system `unzip` binary.

The ordinary suite uses only Node packages: the plugin reader opens DOCX XML to
verify editable text/table structure, and the shared inspector verifies actual
PDF page count, searchable text, embedded font and absence of page images.
`test/document-io.test.mjs` covers block-level `doc_read`, byte-preserving
`doc_edit`, `pdf_read` on a real PDF plus the no-ToUnicode degradation path, and
`doc_export` both with and without a local engine. `test/exam-template.test.mjs`
deliberately retains the pre-existing macOS LibreOffice and Poppler verification
for the special Sichuan template; it is separate from the ordinary
zero-process acceptance path.

## Packaging note

`document-io.mjs` is imported by `plugin.mjs`, so it must be added to the
`PLUGINS` file list for `mochi-documents` in
`apps/desktop/scripts/prepare-mochi-resources.cjs`. It only requires Node
builtins, `pdf-lib` and `@mochi/pdf-layout` — both already staged — and does not
need `jszip` at runtime.
