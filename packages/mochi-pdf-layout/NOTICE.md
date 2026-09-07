# Bundled font source

`assets/fonts/NotoSansSC-Regular.ttf` is a static `wght=400` instance generated
from the pre-existing `plugins/mochi-presentations/assets/fonts/NotoSansSC-VF.ttf`
input (SHA-256 `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`).
The source asset and its SIL Open Font License 1.1 remain unchanged in that
plugin. The generated static asset has SHA-256
`ee0196181d143544016fdae98b4fa83db18536c249068fec361c5a60ef3d9fb7`.

Generation uses the temporary, non-runtime build tool
[`fonttools`](https://github.com/fonttools/fonttools) `4.64.0` (MIT;
wheel SHA-256 `4a05783ff54ce4c7a28f18e5772efdf63c219374bd9ffc55452182e1cef8be60`):

```text
python3 -m fontTools.varLib.instancer NotoSansSC-VF.ttf wght=400 \
  --static --update-name-table --no-recalc-timestamp \
  --output NotoSansSC-Regular.ttf
```

The accompanying `licenses/NotoSansSC-OFL-1.1.txt` is byte-identical to the
pre-existing source license (SHA-256
`6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`).
`fonttools` is not shipped and is not a project dependency.

The layout package intentionally embeds this static font once per PDF rather
than using `fontkit` subsetting. The latter was exercised with the same font
in Poppler and corrupted CJK glyph positions; full embedding produced a
renderable, searchable 6.6 MB sample PDF. This is a file-size tradeoff for
correct text rendering, not a per-page font copy.
