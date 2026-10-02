import {mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../..'),bin=resolve(root,'promo/node_modules/.bin/esbuild');
mkdirSync(resolve(dir,'assets'),{recursive:true});
execFileSync(bin,[resolve(dir,'export.ts'),'--bundle','--platform=node','--format=esm','--outfile='+resolve(dir,'export.generated.mjs')]);
execFileSync('node',[resolve(dir,'export.generated.mjs')]);
copyFileSync(resolve(root,'client-plugins/mochi-lan/client.js'),resolve(dir,'assets/lan-source.txt'));
for(const n of ['gsap.min.js','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf'])copyFileSync(resolve(dir,'../../v10/assets',n),resolve(dir,'assets',n));
for(const n of ['motion.js','motion.css'])copyFileSync(resolve(dir,'..',n),resolve(dir,'assets',n));
execFileSync(bin,[resolve(dir,'native.tsx'),'--bundle','--format=iife','--outfile='+resolve(dir,'assets/native.js'),'--alias:react='+resolve(root,'apps/desktop/runtime-modern/node_modules/react'),'--jsx=automatic','--alias:react/jsx-runtime='+resolve(root,'apps/desktop/runtime-modern/node_modules/react/jsx-runtime.js'),'--loader:.txt=text','--define:process.env.NODE_ENV="production"','--external:/jxl-assets/*']);
const sources=['apps/desktop/electron/dsh/rail-pages.ts','apps/desktop/electron/dsh/rail-model.ts','client-plugins/mochi-lan/client.js'];
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify({recordedReplay:true,sources:sources.map(path=>({path,sha256:createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')}))},null,2)+'\n');

const parent=readFileSync(resolve(dir,'index.html'),'utf8');
const faces=parent.match(/@font-face\{[^}]+\}/g).join('\n').replaceAll('assets/','');
writeFileSync(resolve(dir,'assets/mailbox.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="native.css"><style>${faces}html,body{margin:0;height:100%;overflow:hidden;background:transparent}#native-mailbox{padding:12px;display:flex;justify-content:center}.mochi-lan-panel{animation:none!important}</style></head><body><div id="native-mailbox"></div><script src="native.js"></script></body></html>`);

for(const [a,b]of [["native.js","mo.js"],["native.css","mo.css"],["palettes.css","palettes.css"]])copyFileSync(resolve(dir,"../motion-pass/assets",a),resolve(dir,"assets",b));
