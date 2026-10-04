import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const modules = resolve(process.argv[2] ?? join(repo, 'apps/desktop/runtime-modern/node_modules'));
const resources = join(repo, 'apps/desktop/resources/mochi-web');
const require = createRequire(import.meta.url);
const runtime = require(join(resources, 'runtime-profile.cjs'));
const yaml = createRequire(join(modules, '@deepseek-ai/dsh/package.json'))('yaml');
const root = mkdtempSync(join(tmpdir(), 'mochi-book-skill-profile-'));
const bin = join(modules, '@deepseek-ai/dsh/lib/bin.js');
try {
  for (const role of ['teacher', 'classroom']) {
    const home = join(root, role), userRoot = join(root, `${role}-custom`);
    const options = { homeDir: home, resourceRoot: resources, skillsDir: join(repo, 'skills'), workspaceRoot: repo, runtimeNodeModulesRoot: modules, role };
    runtime.provisionMochiProfiles(options);
    const patchPath = join(home, 'profiles/mochi-web/cordis.patch.yml');
    writeFileSync(patchPath, readFileSync(patchPath, 'utf8') + `\n# user settings remain explicit\n- id: skill-filesystem\n  config:\n    customSkillDirs: [${JSON.stringify(userRoot)}]\n    watchPollIntervalMs: 125\n`);
    runtime.provisionMochiProfiles(options);
    assert.deepEqual(runtime.provisionMochiProfiles(options).updated, [], `${role}: repeat provision`);
    const bookRoot = join(home, 'knowledge/book-skills');
    assert.equal(existsSync(bookRoot), false, 'provision must tolerate a library that is not installed');
    const env = { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' };
    const dump = spawnSync(process.execPath, [bin, '--profile', 'mochi-web', '--dump-config'], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(dump.status, 0, dump.stderr);
    const document = yaml.parseDocument(dump.stdout, { logLevel: 'silent' });
    assert.equal(document.errors.length, 0);
    const row = document.toJS().find(row => row.id === 'skill-filesystem');
    assert.deepEqual(row.config.customSkillDirs, [join(repo, 'skills'), userRoot, bookRoot]);
    assert.equal(row.config.includeDefaultRoots, false);
    assert.equal(row.config.watchPollIntervalMs, 125);
    assert.equal(row.config.customSkillDirs.some(path => path.includes(role === 'teacher' ? '/classroom/' : '/teacher/')), false);

    const probeRoot = join(root, `${role}-probe`);
    mkdirSync(probeRoot); symlinkSync(modules, join(probeRoot, 'node_modules'));
    writeFileSync(join(probeRoot, 'package.json'), JSON.stringify({ name: 'book-skill-profile-probe', type: 'module', main: 'index.mjs' }));
    writeFileSync(join(probeRoot, 'index.mjs'), `
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export const name='book-skill-profile-probe';export const inject=['skills','sessionController','agents'];
export function apply(ctx){const timer=setTimeout(()=>{void(async()=>{try{
 const created=await ctx.sessionController.create({cwd:${JSON.stringify(repo)},agentPreset:'standard'});
 const agent=ctx.agents.get(created.sessionId),lookup={scope:agent,cwd:${JSON.stringify(repo)}};
 const before=await ctx.skills.list(lookup);if(before.some(s=>s.name==='textbook-router-fixture'))throw Error('missing root advertised a skill');
 const dir=${JSON.stringify(join(bookRoot, 'router'))};await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'SKILL.md'),'---\\nname: textbook-router-fixture\\ndescription: Offline textbook fixture router\\n---\\nRead references only when needed.');
 ctx.skills.invalidate?.();let loaded;
 for(let i=0;i<20;i++){loaded=await ctx.skills.get('textbook-router-fixture',lookup);if(loaded)break;await new Promise(r=>setTimeout(r,100));}
 if(loaded?.name!=='textbook-router-fixture')throw Error('role scoped filesystem could not load its book router');
 console.log('BOOK_SKILL_PROFILE_PASS='+JSON.stringify({role:${JSON.stringify(role)},missingRootTolerated:true,routerLoaded:true,bodyChars:loaded.content.length}));process.exit(0);
}catch(e){console.error(String(e));process.exit(1)}})()},100);ctx.effect(()=>()=>clearTimeout(timer))}
`);
    // A minimal official Host verifies the same generated filesystem config
    // without depending on unrelated workspace plugins' development closures.
    const fixtureProfile = join(home, 'profiles/book-router-probe');
    const profileModules = join(fixtureProfile, 'node_modules');
    mkdirSync(profileModules, { recursive: true });
    symlinkSync(probeRoot, join(profileModules, 'book-skill-profile-probe'));
    writeFileSync(join(fixtureProfile, 'cordis.yml'), '[]\n');
    writeFileSync(join(fixtureProfile, 'package.json'), JSON.stringify({ name: 'book-router-probe-profile', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
    writeFileSync(join(fixtureProfile, 'cordis.patch.yml'), yaml.stringify([{ id: 'skill-filesystem', disabled: false, config: row.config },
      { insert: [{ id: 'book-skill-profile-probe', name: 'book-skill-profile-probe' }] }]));
    const result = spawnSync(process.execPath, [bin, '--profile', 'book-router-probe', '--port', '0', '--no-open'], { env, cwd: repo, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, `${role} real Host: ${result.stderr.slice(-4000)}\n${result.stdout.slice(-1500)}`);
    assert.match(result.stdout, /BOOK_SKILL_PROFILE_PASS=/);
  }
  const invalid = '- id: skill-filesystem\n  config: {customSkillDirs: 123}\n';
  assert.throws(() => runtime.mergeBookSkillRoots(invalid, root, join(repo, 'skills'), modules), /字符串列表/);
  console.log('PASS: two isolated role profiles preserve deployment/user roots, tolerate missing library, and load the role-local router through real scoped Host filesystem');
} finally { rmSync(root, { recursive: true, force: true }); }
