import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../..'),assets=resolve(dir,'assets');mkdirSync(assets,{recursive:true});
for(const n of ['gsap.min.js','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf'])copyFileSync(resolve(dir,'../../v10/assets',n),resolve(assets,n));
for(const n of ['motion.js','motion.css'])copyFileSync(resolve(dir,'..',n),resolve(assets,n));
const modelRoot=resolve(root,'Mochi Models/椭圆切线交互模型-高一复习');
let html=readFileSync(resolve(modelRoot,'model-before-inline.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="assets/jsxgraph.css">',`<style>${readFileSync(resolve(modelRoot,'assets/jsxgraph.css'),'utf8')}</style>`);
html=html.replace('<script src="assets/jsxgraphcore.js"></script>',()=>`<script>${readFileSync(resolve(modelRoot,'assets/jsxgraphcore.js'),'utf8')}</script>`);
html=html.replace('</head>','<style>@font-face{font-family:MoFallback;src:url("NotoSansCJKsc-Regular.otf")}body{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",MoFallback,sans-serif}</style></head>');
const lastClose=html.lastIndexOf('</script>');html=html.slice(0,lastClose)+readFileSync(resolve(dir,'model-adapter.js'),'utf8')+'\n'+html.slice(lastClose);
writeFileSync(resolve(assets,'actual-model.html'),html);copyFileSync(resolve(root,'plugins/mochi-modeling/assets/LICENSE.MIT'),resolve(assets,'JSXGraph-LICENSE.MIT'));
const source=resolve(dir,'../../v10/private.nosync/teacher-ui-02.mov');
const shots=[
 {name:'request',start:88,duration:3.4,crop:'1540:390:600:700'},
 {name:'sent',start:106,duration:2.6,crop:'1540:580:600:100'},
 {name:'process',start:127,duration:8,crop:'1540:800:600:100',speed:2},
];
for(const shot of shots)execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(shot.start),'-i',source,'-t',String(shot.duration/(shot.speed||1)),'-vf',`crop=2160:1376:0:64,crop=${shot.crop},setpts=(PTS-STARTPTS)/${shot.speed||1},fps=60,setsar=1`,'-an','-c:v','libx264','-crf','17','-preset','fast','-g','30','-keyint_min','30','-movflags','+faststart','-y',resolve(assets,shot.name+'.mp4')],{stdio:'inherit'});
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-ss','18','-i',resolve(dir,'../../v8/assets/music.wav'),'-t','28','-af','afade=t=in:d=0.15,afade=t=out:st=27.5:d=0.5,loudnorm=I=-17:TP=-1.5:LRA=8','-ar','48000','-ac','2','-y',resolve(assets,'music-review.wav')],{stdio:'inherit'});
const sources=[source,resolve(modelRoot,'model-before-inline.html'),resolve(modelRoot,'assets/jsxgraphcore.js'),resolve(root,'plugins/mochi-modeling/conic.mjs')];
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify({shots,sources:sources.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),renderOnlyAdapter:true},null,2)+'\n');
