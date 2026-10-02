import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {revisePresentationBundle} from '../../../plugins/mochi-presentations/index.mjs';

const dir=dirname(fileURLToPath(import.meta.url));
const previousSourcePath=resolve(dir,'../../v9/demo-workspace/pptx-output/source.json');
const outputDirectory=resolve(dir,'private.nosync/lesson-revised');
const revision={
  slideId:'slide-2', layout:'title-chart', title:'打印页数增加，费用怎样变化？',
  body:['基础费 2 元，每页 0.5 元：y = 0.5x + 2','先观察数据点，再解释直线的起点和升降。'],
  chart:{type:'line',title:'页数与费用（元）',labels:['0 页','5 页','10 页','15 页','20 页'],series:[{name:'费用（元）',values:[2,4.5,7,9.5,12]}]},
  source:{label:'课例材料.txt · 按 y=0.5x+2 计算，演示课例'},
};
await mkdir(dirname(outputDirectory),{recursive:true});
const result=await revisePresentationBundle({previousSourcePath,revision,outputDirectory});
await writeFile(resolve(dir,'lesson-revision-evidence.json'),JSON.stringify({
  method:'Mochi actual revisePresentationBundle; direct local product tool invocation, not a recorded chat',
  previousSourcePath,revision,outputDirectory,
  outputs:{pptx:result.pptxPath,pdf:result.pdfPath,source:result.sourcePath,manifest:result.manifestPath},
},null,2)+'\n');
console.log(JSON.stringify({pptx:result.pptxPath,pdf:result.pdfPath,manifest:result.manifestPath}));
