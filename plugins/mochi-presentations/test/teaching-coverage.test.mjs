import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../plugin.mjs';
import { createQualityReport, validatePresentation } from '../index.mjs';

function presentation(teachingPlan) {
  return {
    schema: 'mochi-lesson-presentation-v1',
    sourceKind: 'model-authored-classroom-draft',
    deckId: 'coverage-test',
    version: 1,
    title: '水循环',
    slides: [
      { id: 'slide-1', version: 1, layout: 'title-body', title: '观察变化', body: ['标记水的状态变化。'] },
      { id: 'slide-2', version: 1, layout: 'title-body', title: '说明发现', body: ['用记录描述观察结果。'] },
      { id: 'slide-3', version: 1, layout: 'cover', title: '课堂标题', body: [] },
    ],
    ...(teachingPlan === undefined ? {} : { teachingPlan }),
  };
}

function qualityFor(source) {
  const input = validatePresentation(source);
  return createQualityReport({
    input,
    inspection: { 文件: { sha256: 'test-hash' }, 页数: input.slides.length, 检查页数: input.slides.length, 幻灯片: [] },
    pptxSha256: 'test-hash',
  }).teachingCoverage;
}

function completePlan() {
  return {
    objectives: [
      { id: 'observe', statement: '用观察记录描述水的状态变化' },
      { id: 'explain', statement: '用记录说明观察到的变化' },
    ],
    slideMappings: [
      { slideId: 'slide-1', objectiveIds: ['observe'], role: '观察活动' },
      { slideId: 'slide-2', objectiveIds: ['observe', 'explain'], role: '理解检查', studentAction: '用记录解释发现', understandingCheck: '能引用一条观察记录说明水的状态变化' },
    ],
  };
}

test('teaching coverage distinguishes no plan, incomplete declarations, and complete mappings', () => {
  const absent = qualityFor(presentation());
  assert.equal(absent.status, 'not-declared');
  assert.match(absent.hints.join(' '), /没有评估课堂目标覆盖/u);

  const incomplete = qualityFor(presentation({
    objectives: [
      { id: 'observe', statement: '描述观察到的变化' },
      { id: 'explain', statement: '解释观察到的变化' },
    ],
    slideMappings: [
      { slideId: 'slide-1', objectiveIds: ['observe'], studentAction: '标记变化' },
    ],
  }));
  assert.equal(incomplete.status, 'incomplete');
  assert.deepEqual(incomplete.unmappedSlideIds, ['slide-2', 'slide-3']);
  assert.deepEqual(incomplete.uncoveredObjectiveIds, ['explain']);
  assert.deepEqual(incomplete.objectivesWithoutCheckIds, ['observe', 'explain']);
  assert.deepEqual(incomplete.incompleteSlideIds, ['slide-1']);
  assert.equal(incomplete.hasStudentAction, true);
  assert.match(incomplete.hints.join(' '), /缺少页面角色/u);
  assert.match(incomplete.hints.join(' '), /封面或章节页可不映射/u);

  const mapped = qualityFor(presentation(completePlan()));
  assert.equal(mapped.status, 'mapped');
  assert.equal(mapped.mappedSlideCount, 2);
  assert.deepEqual(mapped.unmappedSlideIds, ['slide-3']);
  assert.deepEqual(mapped.objectivesWithoutCheckIds, []);
  assert.equal(mapped.hasStudentAction, true);
  assert.match(mapped.hints.join(' '), /不影响覆盖状态/u);
  assert.match(mapped.scope, /不判断目标质量/u);

  const noStudentAction = qualityFor(presentation({
    objectives: [{ id: 'observe', statement: '描述观察到的变化' }],
    slideMappings: [{ slideId: 'slide-1', objectiveIds: ['observe'], role: '观察活动', understandingCheck: '能指出变化位置' }],
  }));
  assert.equal(noStudentAction.status, 'incomplete');
  assert.equal(noStudentAction.hasStudentAction, false);
  assert.match(noStudentAction.hints.join(' '), /没有声明学生行动/u);
});

test('teaching-plan references must point to declared slides and objectives', () => {
  assert.throws(() => validatePresentation(presentation({
    objectives: [{ id: 'observe', statement: '描述变化' }],
    slideMappings: [{ slideId: 'slide-9', objectiveIds: ['observe'] }],
  })), (error) => error.code === 'INVALID_INPUT' && /unknown slide/u.test(error.message));

  assert.throws(() => validatePresentation(presentation({
    objectives: [{ id: 'observe', statement: '描述变化' }],
    slideMappings: [{ slideId: 'slide-1', objectiveIds: ['missing'] }],
  })), (error) => error.code === 'INVALID_INPUT' && /unknown objective/u.test(error.message));
});

test('create reports coverage and revise preserves then rechecks mappings after visible edits', { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-ppt-teaching-coverage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = new Map();
  apply({ tools: { register(tool) { tools.set(tool.name, tool); } } }, {
    allowedRoots: [root],
    converter: { sofficePath: join(root, 'missing-soffice') },
  });

  const create = await tools.get('mochi_ppt_create').execute({
    title: '水循环课堂',
    teachingPlan: completePlan(),
    slides: [
      { heading: '观察变化', bullets: ['标记水的状态变化。'] },
      { heading: '说明发现', bullets: ['用记录描述观察结果。'] },
      { heading: '课堂标题', bullets: [], layout: 'cover' },
    ],
    outputDirectory: join(root, 'v1'),
  });
  assert.equal(create.教学覆盖.status, 'mapped');
  const createManifest = JSON.parse(await readFile(create.产物.manifest, 'utf8'));
  assert.deepEqual(createManifest.quality.teachingCoverage, create.教学覆盖);
  const createSource = JSON.parse(await readFile(create.sourcePath, 'utf8'));
  const createdInspection = await tools.get('ppt_inspect').execute({ path: create.产物.pptx });
  assert.equal(createdInspection.完成, true);
  const firstNotes = createdInspection.幻灯片[0].备注;
  const secondNotes = createdInspection.幻灯片[1].备注;
  assert.match(firstNotes, /Source status: 未核验：未提供来源/u);
  assert.match(firstNotes, /Slide ID: slide-1/u);
  assert.match(firstNotes, /Slide version: 1/u);
  assert.match(firstNotes, /\[?observe\]?：用观察记录描述水的状态变化/u);
  assert.match(firstNotes, /页面作用：观察活动/u);
  assert.match(firstNotes, /学生行动：未声明/u);
  assert.match(firstNotes, /理解检查：未声明/u);
  assert.match(secondNotes, /\[?observe\]?：用观察记录描述水的状态变化/u);
  assert.match(secondNotes, /\[?explain\]?：用记录说明观察到的变化/u);
  assert.match(secondNotes, /页面作用：理解检查/u);
  assert.match(secondNotes, /学生行动：用记录解释发现/u);
  assert.match(secondNotes, /理解检查：能引用一条观察记录说明水的状态变化/u);
  assert.doesNotMatch(createdInspection.幻灯片[2].备注, /教学计划声明/u, 'unmapped cover should retain only its existing notes');

  const revise = tools.get('mochi_ppt_revise');
  const revised = await revise.execute({
    previousSourcePath: create.sourcePath,
    page: 1,
    instruction: '把标题改得更聚焦',
    newTitle: '标记水的状态变化',
    outputDirectory: join(root, 'v2'),
  });
  const revisedSource = JSON.parse(await readFile(revised.sourcePath, 'utf8'));
  assert.deepEqual(revisedSource.teachingPlan.objectives, createSource.teachingPlan.objectives);
  assert.deepEqual(revisedSource.teachingPlan.slideMappings, createSource.teachingPlan.slideMappings);
  assert.deepEqual(revisedSource.teachingPlan.reviewRequiredSlideIds, ['slide-1']);
  assert.equal(revised.教学覆盖.status, 'incomplete');
  assert.deepEqual(revised.教学覆盖.reviewRequiredSlideIds, ['slide-1']);
  assert.match(revised.教学覆盖.hints.join(' '), /可见内容修订后沿用了旧映射/u);
  const revisedManifest = JSON.parse(await readFile(revised.产物.manifest, 'utf8'));
  assert.deepEqual(revisedManifest.quality.teachingCoverage, revised.教学覆盖);
  const revisedInspection = await tools.get('ppt_inspect').execute({ path: revised.产物.pptx });
  const revisedFirstNotes = revisedInspection.幻灯片[0].备注;
  assert.match(revisedFirstNotes, /教学映射待复核/u);
  assert.match(revisedFirstNotes, /页面作用：观察活动/u);
  assert.doesNotMatch(revisedFirstNotes, /已确认|已批准/u);

  const rechecked = await revise.execute({
    previousSourcePath: revised.sourcePath,
    page: 1,
    instruction: '更新目标映射以匹配新页标题',
    newTeachingPlan: completePlan(),
    outputDirectory: join(root, 'v3'),
  });
  const recheckedSource = JSON.parse(await readFile(rechecked.sourcePath, 'utf8'));
  assert.equal(recheckedSource.teachingPlan.reviewRequiredSlideIds, undefined);
  assert.equal(rechecked.教学覆盖.status, 'mapped');
  const recheckedInspection = await tools.get('ppt_inspect').execute({ path: rechecked.产物.pptx });
  const recheckedFirstNotes = recheckedInspection.幻灯片[0].备注;
  assert.match(recheckedFirstNotes, /页面作用：观察活动/u);
  assert.doesNotMatch(recheckedFirstNotes, /教学映射待复核/u);

  const noPlan = await tools.get('mochi_ppt_create').execute({
    title: '无教学计划的普通演示',
    slides: [{ heading: '普通演示页', bullets: ['保留既有来源备注。'] }],
    outputDirectory: join(root, 'no-plan'),
  });
  const noPlanInspection = await tools.get('ppt_inspect').execute({ path: noPlan.产物.pptx });
  assert.equal(noPlanInspection.完成, true);
  assert.equal(
    noPlanInspection.幻灯片[0].备注,
    'Source status: 未核验：未提供来源\nSource: 未提供\nReference: 未提供\nSlide ID: slide-1\nSlide version: 1',
    'without teachingPlan the existing speaker notes remain unchanged',
  );
});
