import { readFileSync } from 'node:fs';
export const petPalettes = JSON.parse(readFileSync(new URL('../assets/mochi-palettes.json', import.meta.url),'utf8'));
export const petPaletteCss = petPalettes.map(p => `[data-mochi-pet-palette="${p.id}"]{${Object.entries(p).filter(([k])=>!['id','label'].includes(k)).map(([k,v])=>`--mochi-pet-${k}:${v}`).join(';')}}`).join('\n') + `
[data-mochi-pet-palette] :is(.expressive-orb__body,.pet__body){fill:var(--mochi-pet-body)!important}
[data-mochi-pet-palette] :is(.expressive-orb__face,.pet__eyes){fill:var(--mochi-pet-eyes)!important}
[data-mochi-pet-palette] :is(.pet__laptop,.orb-companion__laptop) [fill="#4A3826"]{fill:var(--mochi-pet-case)}
[data-mochi-pet-palette] :is(.pet__laptop,.orb-companion__laptop) [fill="#2E2318"]{fill:var(--mochi-pet-screen)}
[data-mochi-pet-palette] :is(.pet__laptop,.orb-companion__laptop) [fill="#6B4E33"]{fill:var(--mochi-pet-base)}
[data-mochi-pet-palette] :is(.pet__laptop,.orb-companion__laptop) [fill="#7A5C3E"]{fill:var(--mochi-pet-front)}
[data-mochi-pet-palette] :is(.pet__laptop,.orb-companion__laptop) [fill="#FFE7C2"]{fill:var(--mochi-pet-glyph)}
.jxl-settings-appearance > .jxl-pet-label{grid-column:1/-1}
.jxl-pet-colors{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start;margin-top:-10px;min-width:0}
.jxl-pet-colors button{white-space:nowrap;flex:none;display:flex;align-items:center;gap:7px;min-height:34px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l3);border-radius:9px;background:var(--jxl-paper);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.jxl-pet-colors button[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary);box-shadow:inset 0 -2px 0 var(--dsw-alias-label-secondary)}
.jxl-pet-colors svg{width:24px;height:24px;flex:none}
.jxl-pet-colors__error{flex-basis:100%;color:var(--dsw-static-red-600);font-size:12px}
`;
