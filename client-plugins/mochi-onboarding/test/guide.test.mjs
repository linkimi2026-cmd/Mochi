import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guideSteps, guideGeometry, normalizeProgress, STEP_IDS } from '../steps.mjs';
import { locateGuideTarget, TARGET_HINTS } from '../navigation.mjs';

test('one role source controls seven original steps without pretending to authenticate', () => {
  for (const role of ['teacher', 'classroom', undefined]) {
    const steps = guideSteps(role);
    assert.deepEqual(steps.map(step => step.id), STEP_IDS);
    assert.match(steps[0].note, /不等于.*认证/);
    assert.match(steps[1].note, /不会替你登录/);
    assert.ok(steps.every(step => step.text && step.actions.length));
  }
  assert.match(guideSteps('teacher')[2].text, /通用 Mochi.*四个专门助手/);
  assert.match(guideSteps('classroom')[5].text, /开始上课.*这节课结束.*课堂管家/);
  assert.match(guideSteps('teacher')[3].text, /语音对话.*提交当前对话.*结束后停止/);
  assert.match(guideSteps('classroom')[0].text, /教师个人称呼在教师端/);
});

test('progress never treats loading, memory fallback or unknown values as persisted', () => {
  assert.deepEqual(normalizeProgress(null), {ready:false,persistent:false,status:'new',step:'identity'});
  assert.equal(normalizeProgress({status:'ready',mode:'memory',writable:true,value:{status:'complete'}}).persistent, false);
  const saved = normalizeProgress({status:'ready',mode:'host',writable:true,value:{version:2,status:'new',step:'input'}});
  assert.deepEqual(saved, {ready:true,persistent:true,status:'new',step:'input'});
  assert.equal(normalizeProgress({status:'ready',value:{status:'complete',step:'settings'}}).status,'new','old completion requires mandatory version');
  assert.equal(normalizeProgress({status:'ready',value:{version:2,status:'skipped',step:'input'}}).status,'new','skip cannot complete mandatory guide');
  assert.equal(normalizeProgress({status:'ready',value:{version:2,status:'complete',step:'settings'}}).status,'complete');
  assert.equal(normalizeProgress({value:{step:'invented'}}).step, 'identity');
});

test('guide geometry stays above the composer and respects small viewports', () => {
  for (const args of [{width:1120,height:840,composerTop:590},{width:390,height:700,composerTop:480},{width:1280,height:720,composerTop:360,headerBottom:70}]) {
    const result = guideGeometry(args);
    assert.equal(result.hidden, false);
    assert.ok(result.top + result.maxHeight <= args.composerTop - 12);
    assert.ok(result.right + result.width <= args.width);
    assert.ok(result.top >= 78);
  }
  assert.equal(guideGeometry({width:390,height:220,composerTop:140}).hidden,true);
});

test('navigation chooses an actual enabled visible target and never a hidden sibling', () => {
  const node = (visibility, disabled=false, ancestor=null) => ({disabled,getClientRects:()=>visibility?[{}]:[],closest:()=>ancestor});
  const hidden=node(false), disabled=node(true,true), inert=node(true,false,{}), actual=node(true);
  let observed;
  const document={querySelectorAll:selector=>{observed=selector;return [hidden,disabled,inert,actual];},querySelector:()=>({closest:()=>actual})};
  assert.equal(locateGuideTarget(document,'camera'),actual);
  assert.match(observed,/摄像头或展台拍题/);
  assert.equal(locateGuideTarget(document,'settings'),actual);
  assert.equal(locateGuideTarget(document,'not-a-real-action'),null);
  assert.equal(locateGuideTarget({querySelectorAll:()=>[hidden,disabled,inert]},'camera'),null);
  assert.match(TARGET_HINTS.camera,/先打开对话/);
});
