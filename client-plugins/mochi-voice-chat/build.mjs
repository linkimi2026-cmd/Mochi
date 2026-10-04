import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const { build } = require('esbuild');
const result = await build({ entryPoints: [new URL('client-entry.mjs', import.meta.url).pathname], bundle: true, platform: 'browser', format: 'cjs', external: ['react','@deepseek-ai/dsh-client-ui-primitives'], write: false, target: 'chrome140' });
await writeFile(new URL('client.js', import.meta.url), `window.__ModuleLoader__.load({id:"mochi-voice-chat",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`);
