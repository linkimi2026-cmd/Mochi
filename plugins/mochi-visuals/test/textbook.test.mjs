// mochi-visuals · teaching_image_match 的测试。
//
// 铁律：本地教材索引里没有匹配时，必须明确返回「本地无匹配」，绝不编造教材原图，
// 也绝不偷偷联网。这里用一个真实建出来的 node:sqlite 索引来验证：
//   * 索引缺失 / 空文件 / 无命中 / 有命中 四条分支都走一遍；
//   * 命中结果的教材ID、PDF页号、印刷页号、识别状态、摘录都来自数据库真行；
//   * 匹配是只读的（跑完之后数据库文件字节不变）；
//   * 联网建议只是文字，且明确标注「未执行联网检索」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../plugin.mjs';
import { normalizeSearchText, textbookDatabasePath } from '../textbook.mjs';
import { expectFailure, makeCtx, tool } from './helpers.mjs';

const PHYSICS_ID = `tb-${'a'.repeat(64)}`;
const CHEMISTRY_ID = `tb-${'b'.repeat(64)}`;

function makeHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'mochi-visuals-textbook-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

/** 建一个与 mochi-knowledge 同结构的真实 SQLite 教材索引。 */
async function seedDatabase(home) {
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(home, 'textbook.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE textbook_books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT, publisher TEXT, volume TEXT,
      library_file TEXT, page_count INTEGER
    );
    CREATE TABLE textbook_pages (
      textbook_id TEXT NOT NULL, pdf_page INTEGER NOT NULL, printed_page INTEGER,
      text_status TEXT, requires_original_page_check INTEGER, display_text TEXT, search_text TEXT
    );
  `);
  const book = db.prepare('INSERT INTO textbook_books (id,title,subject,publisher,volume,library_file,page_count) VALUES (?,?,?,?,?,?,?)');
  book.run(PHYSICS_ID, '普通高中教科书·物理（选择性必修 第一册）', '物理', '人民教育出版社', '物理选择性必修 第一册', '/library/physics-1.pdf', 180);
  book.run(CHEMISTRY_ID, '普通高中教科书·化学（必修 第一册）', '化学', '人民教育出版社', '化学必修 第一册', '/library/chemistry-1.pdf', 160);

  const page = db.prepare('INSERT INTO textbook_pages (textbook_id,pdf_page,printed_page,text_status,requires_original_page_check,display_text,search_text) VALUES (?,?,?,?,?,?,?)');
  const physicsChapter = '第四章 光和折射\n光从空气斜射入水中时，传播方向会发生偏折，这种现象叫作光的折射。';
  // search_text 必须是 knowledge-store 的归一化写法（NFKC + 小写 + 去空白）。
  page.run(PHYSICS_ID, 42, 38, 'ocr', 1, physicsChapter, normalizeSearchText('光的折射'));
  page.run(PHYSICS_ID, 43, 39, 'text-layer', 0, '光的折射定律：入射角与折射角的关系。', normalizeSearchText('光的折射'));
  page.run(PHYSICS_ID, 44, null, 'pending-ocr', 1, '本节插图：光从空气射入水中的折射示意图。', normalizeSearchText('光的折射'));
  page.run(CHEMISTRY_ID, 7, 5, 'text-layer', 0, '胶体的丁达尔效应与光的折射现象对比。', normalizeSearchText('光的折射'));
  page.run(CHEMISTRY_ID, 88, 84, 'text-layer', 0, 'DNA 复制的过程与特点。', normalizeSearchText('DNA复制'));
  db.close();
  return path;
}

function makePlugin(options) {
  const ctx = makeCtx();
  apply(ctx, options);
  return tool(ctx, 'teaching_image_match');
}

const match = (ctx, args) => ctx.execute(args, {});

test('teaching_image_match：本地没有教材索引时返回「本地无匹配」，不编造、不联网', async (t) => {
  const home = makeHome(t);
  const plugin = makePlugin({ textbookDatabasePath: join(home, 'textbook.sqlite') });
  const result = await match(plugin, { topic: '光的折射', subject: '物理' });

  assert.equal(result.ok, true);
  assert.equal(result.工具, 'teaching_image_match');
  assert.equal(result.状态, '本地无匹配');
  assert.equal(result.索引可用, false);
  assert.equal(result.找到教材原图, false);
  assert.equal(result.结果数, 0);
  assert.deepEqual(result.结果, []);
  assert.match(result.原因, /textbook\.sqlite/);
  assert.match(result.原因, /不会联网找图/);
  // 联网建议必须自证未执行
  assert.equal(result.联网检索建议.已执行联网检索, false);
  assert.ok(result.联网检索建议.建议检索词.includes('光的折射'));
  assert.equal(result.联网检索建议.可选开放图库.length >= 1, true);
});

test('teaching_image_match：索引文件为空时不读取、不猜（本地无匹配）', async (t) => {
  const home = makeHome(t);
  const path = join(home, 'textbook.sqlite');
  writeFileSync(path, '');
  const plugin = makePlugin({ textbookDatabasePath: path });
  const result = await match(plugin, { topic: '光的折射' });

  assert.equal(result.状态, '本地无匹配');
  assert.equal(result.索引可用, false);
  assert.equal(result.找到教材原图, false);
  assert.match(result.原因, /为空/);
});

test('teaching_image_match：索引存在但没有命中页时返回「本地无匹配」，索引仍算可用', async (t) => {
  const home = makeHome(t);
  const path = await seedDatabase(home);
  const plugin = makePlugin({ textbookDatabasePath: path });
  const result = await match(plugin, { topic: '完全不存在这个知识点' });

  assert.equal(result.状态, '本地无匹配');
  assert.equal(result.索引可用, true, '索引能打开，只是没命中');
  assert.equal(result.找到教材原图, false);
  assert.equal(result.结果数, 0);
  assert.match(result.原因, /没有与该知识点匹配/);
});

test('teaching_image_match：命中页的教材ID/页号/识别状态/摘录全部来自真实索引行', async (t) => {
  const home = makeHome(t);
  const path = await seedDatabase(home);
  const before = await readFile(path);
  const plugin = makePlugin({ textbookDatabasePath: path });

  const result = await match(plugin, { topic: '光的折射', limit: 8 });
  assert.equal(result.状态, '本地已匹配');
  assert.equal(result.索引可用, true);
  assert.equal(result.找到教材原图, true);
  assert.equal(result.结果数, 4, '同分命中按 PDF 页号升序返回物理 3 页 + 化学 1 页');
  assert.ok(result.取图方式.includes('mochi_knowledge_page_image'));
  assert.match(result.说明, /仍需与该页原图核对/);

  // 结果顺序：同分时按 PDF 页号升序
  assert.deepEqual(result.结果.map((hit) => hit.PDF页号), [7, 42, 43, 44]);

  const byKey = new Map(result.结果.map((hit) => [`${hit.教材ID}#${hit.PDF页号}`, hit]));
  const first = byKey.get(`${PHYSICS_ID}#42`);
  assert.equal(first.书名, '普通高中教科书·物理（选择性必修 第一册）');
  assert.equal(first.学科, '物理');
  assert.equal(first.册别, '物理选择性必修 第一册');
  assert.equal(first.出版社, '人民教育出版社');
  assert.equal(first.印刷页号, 38);
  assert.equal(first.印刷页号状态, '已识别');
  assert.equal(first.识别状态, '离线 OCR（公式/图表须核对原页）');
  assert.equal(first.需核对原页, true);
  assert.match(first.摘录, /光的折射/, '摘录必须围绕命中位置截取');
  assert.match(first.命中方式, /光的折射/);

  // 三条物理页各自的识别状态映射（文字层 / 待离线 OCR / 离线 OCR）
  assert.equal(byKey.get(`${PHYSICS_ID}#43`).识别状态, '文字层');
  assert.equal(byKey.get(`${PHYSICS_ID}#43`).需核对原页, false);
  assert.equal(byKey.get(`${PHYSICS_ID}#44`).识别状态, '待离线 OCR');
  assert.equal(byKey.get(`${PHYSICS_ID}#44`).印刷页号, null);
  assert.equal(byKey.get(`${PHYSICS_ID}#44`).印刷页号状态, '未识别');

  // 化学书的命中页也是真行
  assert.equal(byKey.get(`${CHEMISTRY_ID}#7`).学科, '化学');
  assert.match(byKey.get(`${CHEMISTRY_ID}#7`).摘录, /丁达尔效应/);

  // 只读：数据库文件字节完全没变
  assert.equal((await readFile(path)).equals(before), true, '教材索引不能被写入任何一行');
  assert.equal(statSync(path).size, before.length);
});

test('teaching_image_match：subject / volume / bookId 过滤真的生效', async (t) => {
  const home = makeHome(t);
  const path = await seedDatabase(home);
  const plugin = makePlugin({ textbookDatabasePath: path });

  const all = await match(plugin, { topic: '光的折射', limit: 8 });
  assert.equal(all.结果数, 4, '未过滤时应命中物理 3 页 + 化学 1 页');

  const physics = await match(plugin, { topic: '光的折射', subject: '物理', limit: 8 });
  assert.equal(physics.结果数, 3);
  assert.equal(physics.结果.every((hit) => hit.学科 === '物理'), true);

  const chemistry = await match(plugin, { topic: '光的折射', subject: '化学', limit: 8 });
  assert.equal(chemistry.结果数, 1);
  assert.equal(chemistry.结果[0].教材ID, CHEMISTRY_ID);

  const byVolume = await match(plugin, { topic: '光的折射', volume: '化学必修 第一册', limit: 8 });
  assert.equal(byVolume.结果数, 1);
  assert.equal(byVolume.结果[0].教材ID, CHEMISTRY_ID);

  const byBook = await match(plugin, { topic: '光的折射', bookId: PHYSICS_ID, limit: 8 });
  assert.equal(byBook.结果数, 3);

  const noSuchSubject = await match(plugin, { topic: '光的折射', subject: '生物学', limit: 8 });
  assert.equal(noSuchSubject.状态, '本地无匹配');
  assert.equal(noSuchSubject.索引可用, true, '索引可用，只是该学科没有命中');
});

test('teaching_image_match：检索词按 knowledge-store 的归一化规则匹配（大小写/空格/章节号）', async (t) => {
  const home = makeHome(t);
  const path = await seedDatabase(home);
  const plugin = makePlugin({ textbookDatabasePath: path });

  // 带空格的查询要能命中已经去空格的 search_text
  const spaced = await match(plugin, { topic: '光的 折射', limit: 8 });
  assert.equal(spaced.状态, '本地已匹配');
  assert.equal(spaced.结果数, 4);

  // 章节标题形态：「第4章 光的折射」应能拆出「光的折射」这个检索词
  const chapter = await match(plugin, { topic: '第4章 光的折射', limit: 8 });
  assert.equal(chapter.状态, '本地已匹配');
  assert.ok(chapter.命中的检索词.includes(normalizeSearchText('光的折射')), `命中的检索词应包含归一化后的词：${JSON.stringify(chapter.命中的检索词)}`);

  // 英文大小写不敏感
  const dna = await match(plugin, { topic: 'dna 复制', limit: 8 });
  assert.equal(dna.状态, '本地已匹配');
  assert.equal(dna.结果[0].教材ID, CHEMISTRY_ID);
  assert.equal(dna.结果[0].PDF页号, 88);

  // limit 会被收敛到 1–8
  const clamped = await match(plugin, { topic: '光的折射', limit: 99 });
  assert.ok(clamped.结果数 <= 8, `limit 应被收敛到上限 8，实际 ${clamped.结果数}`);
});

test('teaching_image_match：联网建议开关与 topic 校验（负向对照）', async (t) => {
  const home = makeHome(t);
  const plugin = makePlugin({ textbookDatabasePath: join(home, 'textbook.sqlite') });

  const withSuggestion = await match(plugin, { topic: '光的折射' });
  assert.equal(withSuggestion.状态, '本地无匹配');
  assert.ok(withSuggestion.联网检索建议, '默认应附带联网建议');
  assert.equal(withSuggestion.联网检索建议.已执行联网检索, false);

  const withoutSuggestion = await match(plugin, { topic: '光的折射', allowNetworkSuggestion: false });
  assert.equal(withoutSuggestion.联网检索建议, undefined, '显式关闭后不应出现联网建议字段');

  await expectFailure(match(plugin, { topic: '' }), 'BAD_ARGUMENT', '空 topic');
  await expectFailure(match(plugin, { topic: '光' }), 'BAD_ARGUMENT', 'topic 过短');
  await expectFailure(match(plugin, { topic: '折'.repeat(200) }), 'BAD_ARGUMENT', 'topic 过长');
});

test('teaching_image_match：索引不是有效 SQLite 时明确报「索引不可用」，不抛异常也不编造', async (t) => {
  const home = makeHome(t);
  const path = join(home, 'textbook.sqlite');
  writeFileSync(path, '这不是一个 SQLite 文件，只是一段文本');
  const plugin = makePlugin({ textbookDatabasePath: path });
  const result = await match(plugin, { topic: '光的折射' });

  assert.equal(result.状态, '本地无匹配');
  assert.equal(result.索引可用, false);
  assert.equal(result.找到教材原图, false);
  assert.equal(result.结果数, 0);
  assert.match(result.原因, /无法以只读方式打开|读取失败/);
});

test('teaching_image_match：数据库路径按 MOCHI_KNOWLEDGE_HOME / DSH_HOME 解析', async (t) => {
  const home = makeHome(t);
  const knowledgeHome = join(home, 'knowledge');
  mkdirSync(knowledgeHome, { recursive: true });
  await seedDatabase(knowledgeHome);

  // 1) 走 options.env 里的 MOCHI_KNOWLEDGE_HOME
  assert.equal(
    textbookDatabasePath({ env: { MOCHI_KNOWLEDGE_HOME: knowledgeHome } }),
    join(knowledgeHome, 'textbook.sqlite'),
  );
  // 2) 走 DSH_HOME 下的 knowledge/
  assert.equal(
    textbookDatabasePath({ env: { DSH_HOME: home } }),
    join(home, 'knowledge', 'textbook.sqlite'),
  );

  const plugin = makePlugin({ env: { MOCHI_KNOWLEDGE_HOME: knowledgeHome } });
  const result = await match(plugin, { topic: '光的折射', limit: 2 });
  assert.equal(result.状态, '本地已匹配');
  assert.equal(result.教材索引, join(knowledgeHome, 'textbook.sqlite'));
  assert.equal(result.结果数, 2);
});
