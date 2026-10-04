# Pinned book-to-skill extraction and scanner

Unmodified Python import closure from virgiliojr94/book-to-skill v1.4.0,
commit `c108d25b0cb58e1bdc361f3de02ed9f37075152f`, MIT. `UPSTREAM.json`
records every retained upstream file's SHA256. No package installation is needed
for the Markdown path. Other parsers remain only because the upstream CLI imports
them; Mochi supplies only its own offline Markdown with `--install-missing no`.

This is partial reuse of the extraction CLI and advisory scanner, **not** execution
of the upstream Full Conversion workflow. Generated Mochi skills are retrieval
instructions and source references, not semantic chapter summaries or distilled
frameworks. Raw source pages remain data and never grant tool authority.

The upstream sanitizer removes some invisible mathematical operators. Its text
is only a derived search aid; original source-page text and PDF references remain
separate. The scanner checks generated instruction files, while its reported
unscanned `references/` contain source data. A passing scan does not certify books.
