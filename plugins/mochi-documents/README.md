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
node --test test/generator.test.mjs
```

The ordinary suite uses only Node packages: JSZip opens DOCX XML to verify editable text/table structure, and the shared inspector verifies actual PDF page count, searchable text, embedded font and absence of page images. `test/exam-template.test.mjs` deliberately retains the pre-existing macOS LibreOffice and Poppler verification for the special Sichuan template; it is separate from the ordinary zero-process acceptance path.
