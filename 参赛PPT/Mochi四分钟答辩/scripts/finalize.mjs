import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const home=os.homedir();
const primaryRuntime=process.env.CODEX_PRIMARY_RUNTIME ?? path.join(home,'.codex/plugins/cache/openai-primary-runtime');
const presentationsRoot=path.join(primaryRuntime,'presentations');
const versions=(await fs.readdir(presentationsRoot,{withFileTypes:true}))
  .filter((entry)=>entry.isDirectory())
  .map((entry)=>entry.name)
  .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const version=versions.at(-1);
if(!version) throw new Error(`未找到 Presentations 运行时：${presentationsRoot}`);

const skill=path.join(presentationsRoot,version,'skills/presentations');
const utility=path.join(skill,'container_tools/artifact_tool_utils.mjs');
const {finalizePresentation}=await import(pathToFileURL(utility));
const dependencies=process.env.CODEX_RUNTIME_DEPENDENCIES ?? path.join(home,'.cache/codex-runtimes/codex-primary-runtime/dependencies');
process.env.RUNTIME_NODE_MODULES ??=path.join(dependencies,'node/node_modules');

console.log(await finalizePresentation({
  workspaceDir:root,
  candidatePath:path.join(root,'.build/candidate.pptx'),
  finalPath:path.join(root,'output/Mochi_四分钟答辩_双端互联版.pptx'),
  pythonExecutable:path.join(dependencies,'python/bin/python3'),
  integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],
  explicitTotalSlideCount:6,
  fontPolicy:{basis:'design',families:['Songti SC','Heiti TC']},
  verifyArtifactToolImport:true,
  receiptPath:path.join(root,'.build/validation-dual-end.json'),
}));
