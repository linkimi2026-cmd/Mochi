#!/usr/bin/env node
/** Explicit paid DeepSeek-only synthetic Agent probe; never part of npm check. */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const requireFromDesktop = createRequire(join(desktopRoot, 'package.json'));
const dshBin = process.env.MOCHI_DSH_BIN ?? requireFromDesktop.resolve('@deepseek-ai/dsh/lib/bin.js');
const nodeBin = process.env.MOCHI_DSH_NODE ?? process.execPath;
if (process.argv.length !== 4 || process.argv[2] !== '--run' || !process.argv[3].startsWith('/')) {
  console.error(
    'Paid DeepSeek Agent probe: node apps/desktop/scripts/probe-agent-live.mjs --run /absolute/new-output-directory',
  );
  process.exit(2);
}
const outputRoot = process.argv[3];
mkdirSync(outputRoot);
const apiKey = requireFromDesktop('yaml').parse(
  readFileSync(join(workspaceRoot, '.mochi-home.nosync/.credentials.yaml'), 'utf8'),
).refs?.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('Missing DeepSeek credential');

function redact(value) {
  return value.replaceAll(apiKey, '[redacted]').replace(/token=[^\s]+/gi, 'token=[redacted]');
}

function runDsh(args, env, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [dshBin, ...args], {
      cwd: workspaceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-32_768);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.stdout.on('data', (chunk) => {
      const t = chunk.toString();
      if (t.includes('MOCHI_')) console.log(redact(t));
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`dsh probe timed out after ${timeoutMs}ms\n${redact(output)}`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`dsh probe exited code=${String(code)} signal=${String(signal)}\n${redact(output)}`));
    });
  });
}

function writeProbePackage(dir) {
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(desktopRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'skill-catalog-probe',
        private: true,
        version: '0.0.0',
        type: 'module',
        main: 'index.mjs',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'index.mjs'),
    `
import { assembleContextFor } from "@deepseek-ai/dsh-agent";
import { writeFile } from "node:fs/promises";
export const name = "skill-catalog-probe";
export const inject = ["agents", "sessionController", "sessionSkillCatalog", "skills", "tools", "systemPrompt"];

export function apply(ctx) {
  const timer = setTimeout(() => {
    void (async () => {
      let exitCode = 1;
      try {
        const created = await ctx.sessionController.create({
          cwd: process.env.MOCHI_SKILL_PROBE_CWD,
          agentPreset: "standard",
        });
        const agent = ctx.agents.get(created.sessionId);
        if (!agent) throw new Error("Session Agent unavailable");
        await ctx.sessionController.selectModel({sessionId:created.sessionId,provider:"deepseek-official",model:"deepseek-flash",reasoningEffort:"high"});
        let steps=0;
        agent.ctx.on("agent/request", async (_payload,next)=>{
          if(++steps>20) throw new Error("Probe request budget exceeded");
          const request=await next();
          if(request.provider!=="deepseek-official"||request.model!=="deepseek-flash")throw new Error("Non-DeepSeek route rejected");
          console.log("MOCHI_AGENT_STEP="+steps);
          return {...request,maxTokens:5000};
        });
        const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent, new AbortController().signal));
        await writeFile(process.env.MOCHI_AGENT_OUTPUT+"/initial-prompt.json",JSON.stringify(assembly,null,2));
        const input="请制作5页小学四年级水循环课件，使用自然清新的配色和有变化的版式，包含蒸发、凝结、降水以及一道观察问题。不要虚构数据。输出到当前工作目录中的新子目录，给我可用的PPTX。请按课件制作规范自行完成必要检查。此为合成评测，无需外部资料，不使用联网检索或其他模型。";
        await writeFile(process.env.MOCHI_AGENT_OUTPUT+"/input.txt",input);
        await ctx.sessionController.prompt({sessionId:created.sessionId,requestId:"deepseek-ppt-synthetic-1",content:[{type:"text",text:input}]},new AbortController().signal);
        await agent.whenIdle();
        const events=agent.session.snapshotEvents();
        const clean=JSON.stringify(events.filter(event=>["assistant/message","tool/call","tool/result","request/header","turn/start","turn/end","step/start","step/end"].includes(event.type)),(key,value)=>{
          if(Array.isArray(value)) return value.filter(item=>item?.type!=="reasoning");
          return key==="reasoning_content"?undefined:value;
        });
        await writeFile(process.env.MOCHI_AGENT_OUTPUT+"/trace.json",clean);
        console.log("MOCHI_AGENT_FINISHED="+JSON.stringify({sessionId:created.sessionId,status:agent.status,steps,events:events.length}));
        const ending=events.filter(event=>event.type==="turn/end").at(-1);
        await writeFile(process.env.MOCHI_AGENT_OUTPUT+"/run.json",JSON.stringify({provider:"deepseek-official",model:"deepseek-flash",reasoningEffort:"high",steps,ending:ending?.data,status:"unreviewed"},null,2));
        exitCode=ending?.data?.reason?.kind==="error"?1:0;
      } catch (error) {
        console.error("MOCHI_SKILL_CATALOG_ERROR=" + String(error.stack ?? error));
      } finally {
        setTimeout(() => process.exit(exitCode), 20);
      }
    })();
  }, 100);
  ctx.effect(() => () => clearTimeout(timer), "skill-catalog-probe timer");
}
`,
  );
}

function writeProfile(home, probeDir) {
  const profileDir = join(home, 'profiles', 'skill-catalog-probe');
  const nodeModulesDir = join(profileDir, 'node_modules');
  mkdirSync(nodeModulesDir, { recursive: true });
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n');
  writeFileSync(join(profileDir, 'profile.json'), '{}\n');
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'mochi-skill-catalog-profile',
        private: true,
        version: '0.0.0',
        dependencies: {
          'skill-catalog-probe': `link:${probeDir}`,
          'mochi-hello': `link:${join(workspaceRoot, 'plugins', 'mochi-hello')}`,
          'mochi-presentations': `link:${join(workspaceRoot, 'plugins', 'mochi-presentations')}`,
        },
        dsh: {
          profile: {
            bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
            patchReload: 'startup',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  symlinkSync(probeDir, join(nodeModulesDir, 'skill-catalog-probe'), 'dir');
  symlinkSync(join(workspaceRoot, 'plugins', 'mochi-hello'), join(nodeModulesDir, 'mochi-hello'), 'dir');
  symlinkSync(
    join(workspaceRoot, 'plugins', 'mochi-presentations'),
    join(nodeModulesDir, 'mochi-presentations'),
    'dir',
  );
  writeFileSync(
    join(profileDir, 'cordis.patch.yml'),
    `
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: high
- id: llm-deepseek
  config:
    baseURL: https://api.deepseek.com
    apiKeyEnv: DEEPSEEK_API_KEY
    models:
      - id: deepseek-flash
        inputModalities: [text, image]
- id: tool-subagent
  disabled: true

- id: skill-filesystem
  disabled: false
  config:
    providerName: filesystem
    includeDefaultRoots: false
    customSkillDirs:
      - ${JSON.stringify(join(workspaceRoot, 'skills'))}

- insert:
    - id: mochi-hello
      name: mochi-hello
    - id: mochi-presentations
      name: mochi-presentations
      config:
        allowedRoots: [${JSON.stringify(join(home, 'work'))}]
    - id: skill-catalog-probe
      name: skill-catalog-probe
`,
  );
}

const home = mkdtempSync(join(tmpdir(), 'mochi-skill-profile-'));
try {
  mkdirSync(join(home, 'work'));
  const probeDir = join(home, 'skill-catalog-probe');
  writeProbePackage(probeDir);
  writeProfile(home, probeDir);
  const env = {
    PATH: process.env.PATH,
    NAPI_RS_NATIVE_LIBRARY_PATH: process.env.MOCHI_PROBE_CANVAS,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    HOME: home,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(home, 'agents'),
    DSH_TELEMETRY_DISABLED: '1',
    MOCHI_SKILL_PROBE_CWD: join(home, 'work'),
    MOCHI_AGENT_OUTPUT: outputRoot,
    DEEPSEEK_API_KEY: apiKey,
    NO_COLOR: '1',
  };

  console.log(`PROBE_HOME=${home}`);
  console.log(redact(await runDsh(['--profile', 'skill-catalog-probe', '--port', '0', '--no-open'], env)));
} finally {
  try {
    cpSync(join(home, 'work'), join(outputRoot, 'artifacts'), { recursive: true });
    if (existsSync(join(home, 'attachments')))
      cpSync(join(home, 'attachments'), join(outputRoot, 'attachments'), { recursive: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  console.log(`Evidence: ${outputRoot} (unreviewed; process exit is not quality acceptance)`);
}
