import fs from 'node:fs';
import * as fontkit from '../node_modules/fontkit/dist/module.mjs';
const source = ['index.html'].map(p=>fs.readFileSync(new URL(p,import.meta.url),'utf8')).join('');
const chars=[...new Set([...source].filter(c=>c.codePointAt(0)>=0x3400 && c.codePointAt(0)<=0x9fff))];
for(const f of ['NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf']) {
 const font=fontkit.openSync(new URL('assets/'+f,import.meta.url).pathname);
 const missing=chars.filter(c=>!font.hasGlyphForCodePoint(c.codePointAt(0)));
 console.log(JSON.stringify({font:f,version:font.version,checkedHan:chars.length,missing}));
 if(missing.length)process.exitCode=1;
}
