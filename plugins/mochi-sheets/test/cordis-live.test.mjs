import {Context,Service} from '@deepseek-ai/cordis';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../index.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('real Cordis services allow spreadsheet read without undeclared service access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mochi-promo-sheet-'));
 const ctx=new Context();const registered=[];
 class Tools extends Service {constructor(c){super(c,'tools')}register(t){registered.push(t);return()=>{}}}
 class Policy extends Service {constructor(c){super(c,'sandboxPolicy')}resolve(){return {mode:'workspace-write',workspaceRoot:root}}}
 try{
  await ctx.plugin(Tools);await ctx.plugin(Policy);await ctx.plugin(plugin,{allowedRoots:[root]});
  await writeFile(join(root,'scores.csv'),'姓名,分数\n演示甲,88\n');
  const tool=registered.find(t=>t.name==='spreadsheet_read');assert.ok(tool);
  const result=await tool.execute({path:join(root,'scores.csv')},{agent:{session:{header:{cwd:root}}}});
  assert.match(JSON.stringify(result),/88/);
 }finally{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
});
