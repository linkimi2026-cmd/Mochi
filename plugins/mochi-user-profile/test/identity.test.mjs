import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {productIdentityPrompt,currentProductIdentity} from '../store.mjs';
import {apply} from '../index.mjs';

test('product identity separates user address and model facts, preserving role and explicit nickname',()=>{
  for(const role of ['teacher','classroom']){
    const text=productIdentityPrompt(role);
    assert.match(text,/你是 Mochi/);assert.match(text,/直接回答“我叫 Mochi”/);
    assert.match(text,/不要主动补充底层模型名称/);assert.match(text,/只有用户明确询问底层模型/);
    assert.match(text,/当前可信运行信息中的选中模型 ID/);assert.match(text,/没有可信资料就说无法确认/);
    assert.match(text,/旧助手回答中的自称/);assert.match(text,/不得覆盖当前产品身份/);
    assert.match(text,/是 Mochi 对用户或班级的称呼，不是 Mochi 的名字/);
    assert.match(text,/用户当前明确给你起的昵称/);
    assert.match(text,role==='teacher'?/教师端/:/教室大屏/);
    assert.doesNotMatch(text,/Mochi (?:由|是由).*?(?:开发|训练)/);
  }
});

test('identity has a distinct public section, exists before user setup, and disposes with address',()=>{
  const root=mkdtempSync(join(tmpdir(),'mochi-identity-'));
  try {
    const sections=[],contexts=[],disposed=[];let cleanup;
    const ctx={connection:{fetch:{register:()=>()=>disposed.push('route')}},
      systemPrompt:{getSectionOrder:()=>100,section:section=>{sections.push(section);return()=>disposed.push(section.name);},context:context=>{contexts.push(context);return()=>disposed.push(context.name);}},
      effect:effect=>{cleanup=effect();}};
    apply(ctx,{role:'classroom',dataRoot:root});
    assert.deepEqual(sections.map(x=>x.name),['mochi:product-identity','mochi:user-address']);
    assert.equal(sections[0].order,101);assert.equal(sections[0].interpolate,false);
    assert.match(sections[0].text(),/你是 Mochi/);assert.equal(sections[1].text(),'');
    assert.equal(contexts[0].text(),currentProductIdentity());assert.ok(currentProductIdentity().length<180);assert.doesNotMatch(currentProductIdentity(),/MiMo|MIMO/);
    cleanup();assert.deepEqual(disposed,['route','mochi:product-identity','mochi:current-product-identity','mochi:user-address']);
  } finally {rmSync(root,{recursive:true,force:true});}
});
