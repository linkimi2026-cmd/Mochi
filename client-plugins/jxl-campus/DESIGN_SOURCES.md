# Campus sidebar design sources

- The five inline SVG glyphs follow the 24px, `currentColor`, rounded-stroke
  contract in the upstream [Lucide repository](https://github.com/lucide-icons/lucide).
  They are copied as five local paths, so the runtime does not add an icon
  package or load an external asset:
  [`clipboard-check`](https://github.com/lucide-icons/lucide/blob/main/icons/clipboard-check.svg),
  [`arrow-left-right`](https://github.com/lucide-icons/lucide/blob/main/icons/arrow-left-right.svg),
  [`messages-square`](https://github.com/lucide-icons/lucide/blob/main/icons/messages-square.svg),
  [`contact-round`](https://github.com/lucide-icons/lucide/blob/main/icons/contact-round.svg), and
  [`chart-no-axes-combined`](https://github.com/lucide-icons/lucide/blob/main/icons/chart-no-axes-combined.svg).
- The group material and motion reuse existing project tokens from
  `foundation/ui/jxl-theme-bridge.css`. Press feedback is limited to a small
  scale change and is removed under `prefers-reduced-motion`; reduced
  transparency uses an opaque project surface.
