import { MOCHI_CONTROLS_CSS } from "./controls.generated";
/** Shared appearance for standalone startup and diagnostic documents. */
export const PAPER_WINDOW_CSS = MOCHI_CONTROLS_CSS + `
:root{color-scheme:light;--paper-canvas:#f6f3ec;--paper-surface:#fffdf8;--paper-recess:#ece8df;--paper-ink:#34332f;--paper-muted:#706b60;--paper-line:#d9d3c6;--paper-accent:#dec49d;--paper-success:#356748}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--paper-canvas:#242320;--paper-surface:#2d2b27;--paper-recess:#39362f;--paper-ink:#f1ede4;--paper-muted:#b4ac9e;--paper-line:#575146;--paper-success:#b3d3b5}}
body{background:var(--paper-canvas);color:var(--paper-ink)}
button:focus-visible{outline:2px solid var(--paper-ink);outline-offset:3px}
button{transition:transform 100ms ease,box-shadow 100ms ease}
button:active:not(:disabled){transform:translateY(1px)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
