import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url)),assets=resolve(dir,'assets');
mkdirSync(assets,{recursive:true});
for(const name of ['gsap.min.js','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf']) copyFileSync(resolve(dir,'../../v10/assets',name),resolve(assets,name));
for(const name of ['motion.js','motion.css','paper-transfer.js','paper-transfer.css','paper-world.js','paper-world.css']) copyFileSync(resolve(dir,'..',name),resolve(assets,name));
const gradePath=resolve(dir,'../../v9/demo-workspace/grade-output/charts/各科平均分对比-v2.svg');
const svg=readFileSync(gradePath,'utf8');
// The generated chart's geometry, labels and values are retained verbatim.
writeFileSync(resolve(assets,'grade.js'),`window.mountGrade=()=>{document.querySelector('#grade-native').innerHTML=${JSON.stringify(svg)}};`);
const sources=[
 '../../v9/demo-workspace/pptx-output/presentation-preview.pdf',
 'private.nosync/lesson-revised/presentation-preview.pdf',
 '../../v9/demo-workspace/grade-output/charts/各科平均分对比-v2.svg',
 '../../../Mochi Documents/document-bed40cb7-1f90-4460-adae-3e036babe5e4/document.pdf',
];
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify(sources.map(path=>({path,sha256:createHash('sha256').update(readFileSync(resolve(dir,path))).digest('hex')})),null,2)+'\n');
