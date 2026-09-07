# Mochi Presentations

This isolated module turns already authorized structured lesson-plan slides into an editable PPTX and a PDF drawn directly from the same structured input. It does not inspect attachments, invoke a model, connect to chat, use local LibreOffice, or use page screenshots.

[PptxGenJS 4.0.1](https://github.com/gitbrent/PptxGenJS) remains the editable Office writer. [pdf-lib 1.17.1](https://github.com/Hopding/pdf-lib), [@pdf-lib/fontkit 1.1.1](https://github.com/Hopding/fontkit), and the shared `@mochi/pdf-layout` package draw the PDF text and native table geometry. Chinese text uses the bundled [Noto Sans SC variable TTF](https://github.com/notofonts/noto-cjk/tree/main/Sans/Variable/TTF/Subset), embedded as a subset in every PDF under the included SIL Open Font License 1.1. This is a direct renderer for the bounded `mochi-lesson-presentation-v1` input, not a general PPTX-to-PDF converter.

`generatePresentationBundle` accepts 1–40 slides with bounded titles, projection-readable body capacity, explicit source metadata, and either a title/body or title/native-table layout. The same validated slide objects drive both the editable PPTX and direct PDF. PDF verification opens the generated file in pure JavaScript, checks its page count, embedded Unicode font and searchable title/body/table text, and rejects page-image substitutes. The host assigns a new absolute output directory; an existing target is never overwritten.

`revisePresentationBundle` reads a prior bundle's validated `source.json`, changes exactly one named slide, increments that slide and deck version, and preserves every other slide's content, source, version and semantic hash. It publishes a new output bundle rather than overwriting the prior files.

The fixture is demonstration content written for tests. It is not content extracted by a model from a user attachment, and this module is not yet registered in Mochi chat or UI.

## Tests

```sh
npm ci --ignore-scripts
npm test
```

The ordinary test suite uses only Node.js packages. It opens the generated PPTX through JSZip to prove text and `a:tbl` table structures remain editable, and verifies PDF page count, searchable text and embedded font through the shared pure-JS inspector.
