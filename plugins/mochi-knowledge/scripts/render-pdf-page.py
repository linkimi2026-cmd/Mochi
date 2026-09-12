#!/usr/bin/env python3
"""Render one trusted, already-imported PDF page for the offline OCR preprocessor."""
import argparse
from pathlib import Path

import pypdfium2 as pdfium


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--page", required=True, type=int)
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()
    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    if not source.is_file() or args.page < 1 or not 0.5 <= args.scale <= 4.0:
        raise SystemExit(2)
    output.parent.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(source))
    try:
        if args.page > len(document):
            raise SystemExit(2)
        page = document[args.page - 1]
        try:
            bitmap = page.render(scale=args.scale)
            image = bitmap.to_pil()
            try:
                image.save(output, format="PNG")
            finally:
                image.close()
        finally:
            page.close()
    finally:
        document.close()


if __name__ == "__main__":
    main()
