import {readFileSync,writeFileSync,mkdirSync,readdirSync,symlinkSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..'),previous=resolve(dir,'../pacing-v7');
const palettes=JSON.parse(readFileSync(resolve(root,'client-plugins/jxl-theme/assets/mochi-palettes.json')));
const logo=resolve(root,'apps/desktop/build/icon-source.svg');
const themes={opening:'cream',team:'sage',teaching:'caramel',delivery:'caramel',model:'cream',mailbox:'peach',students:'sage',query:'cream',collaboration:'peach',daily:'sage',ending:'cream'};
const manifest=[];mkdirSync(resolve(dir,'assets'),{recursive:true});
execFileSync(resolve(root,'promo/node_modules/.bin/esbuild'),[resolve(dir,'actor.ts'),'--bundle','--format=iife','--outfile='+resolve(dir,'assets/actor.js')],{stdio:'inherit'});
function assets(folder,source){
 const target=resolve(folder,'assets');mkdirSync(target,{recursive:true});
 for(const name of readdirSync(source)){const dest=resolve(target,name);if(!existsSync(dest))symlinkSync(relative(target,resolve(source,name)),dest)}
 copyFileSync(logo,resolve(target,'brand.svg'));copyFileSync(resolve(dir,'assets/actor.js'),resolve(target,'actor.js'));
}
function themed(html,id,palette,next){
 const code=readFileSync(resolve(dir,'theme.js'),'utf8');
 return html.replace('</head>','<script src="assets/actor.js"></script></head>').replace('</body>',`<script>${code}\nMochiBrand.apply(${JSON.stringify({id,palette:palettes.find(p=>p.id===palette),next:palettes.find(p=>p.id===next),palettes})});MochiFilmActor.install(${JSON.stringify({id,palette:palettes.find(p=>p.id===palette),next:palettes.find(p=>p.id===next),palettes})});</script></body>`);
}
for(const [id,palette]of Object.entries(themes)){
 const folder=resolve(dir,id),source=resolve(previous,id);mkdirSync(folder,{recursive:true});assets(folder,resolve(source,'assets'));
 let html=readFileSync(resolve(source,'index.html'),'utf8');
 manifest.push({id,palette,source:relative(root,resolve(source,'index.html')),sha256:createHash('sha256').update(html).digest('hex')});
 if(id==='students')html=html.replace('"targets":[".card"]','"targets":[".card",".film-pointer-layer"]').replace('[33.4,35.8,[[1.18,1700,725]],"已看到状态"]','[29.2,31.5,[[1.12,680,850]],"从叫人通知引导到确认已看到"],[33.4,35.8,[[1.18,1700,725]],"已看到状态"]');
 if(id==='ending')html=readFileSync(resolve(dir,'ending.html'),'utf8');
 // The new opening identity replaces only the redundant old editorial greeting.
 if(id==='opening')html=html.replace('一声问候，一个开始。','你的 AI 校园工作伙伴。');
 writeFileSync(resolve(folder,'index.html'),themed(html,id,palette));
}
const sequence=['cream','sage','caramel','cream','peach','sage','cream','sage'];
for(let i=0;i<7;i++){
 const folder=resolve(dir,'bridges',String(i)),source=resolve(dir,'../bridges',String(i));mkdirSync(folder,{recursive:true});
 // Incoming/outgoing handles must be generated locally, never overwrite the prior edition.
 const target=resolve(folder,'assets');mkdirSync(target,{recursive:true});
 for(const n of readdirSync(resolve(source,'assets'))){if(/^(in|out)(-short)?\.mp4$/.test(n))continue;const dest=resolve(target,n);if(!existsSync(dest))symlinkSync(relative(target,resolve(source,'assets',n)),dest)}
 copyFileSync(logo,resolve(target,'brand.svg'));copyFileSync(resolve(dir,'assets/actor.js'),resolve(target,'actor.js'));
 writeFileSync(resolve(folder,'index.html'),themed(readFileSync(resolve(source,'index.html'),'utf8').replace('scale:.55,rotation:0','scale:.95,rotation:0').replace('y:y1,scale:.95','y:Math.min(y1,820),scale:.95').replace('actor(50,1010,1760,940,2250,720)','actor(50,1010,1000,360,2250,720)').replace('actor(150,1010,1420,1040,2250,1000)','actor(150,1010,960,200,2250,1000)').replace('actor(2100,1030,1770,1070,2250,1120)','actor(2100,-350,650,-30,1200,-450)'),'bridge-'+i,i===6?'peach':sequence[i],sequence[i+1]));
}
const greeting=resolve(dir,'greeting');mkdirSync(greeting,{recursive:true});assets(greeting,resolve(dir,'../../greeting-chapter/assets'));
writeFileSync(resolve(greeting,'index.html'),themed(readFileSync(resolve(dir,'greeting.html'),'utf8'),'greeting','cream'));
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify({edition:8,palettesSource:'client-plugins/jxl-theme/assets/mochi-palettes.json',palettes,logoSource:'apps/desktop/build/icon-source.svg',logoSha256:createHash('sha256').update(readFileSync(logo)).digest('hex'),actorSources:['client-plugins/jxl-brand/src/bloub-motion.ts','client-plugins/jxl-brand/src/vendor/bloub/engine.ts','client-plugins/jxl-brand/src/vendor/bloub/states.ts'].map(source=>({source,sha256:createHash('sha256').update(readFileSync(resolve(root,source))).digest('hex')})),productUiModified:false,chapters:manifest},null,2)+'\n');
console.log('Prepared brand-v8 compositions');
