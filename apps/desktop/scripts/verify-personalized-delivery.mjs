// Read-only verification of explicit product resources and textbook metadata.
// Does not launch an app, read credentials/conversations, or write role homes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
const repo=resolve(import.meta.dirname,'../../..');
const release=resolve(process.argv[2]??join(repo,'apps/desktop/release/mac-arm64/Mochi.app'));
const installed=resolve(process.argv[3]??'/Applications/Mochi.app');
const output=resolve(process.argv[4]??join(repo,'docs/evidence/textbook-skills-2026-10-01/final-delivery.json'));
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const root=app=>join(app,'Contents/Resources/mochi');
const files=[
 ['client-plugins/mochi-model-presets/reasoning.mjs','plugins/mochi-model-presets/reasoning.mjs'],
 ['client-plugins/mochi-model-presets/client.js','plugins/mochi-model-presets/client.js'],
 ['plugins/mochi-user-profile/holiday-greeting.mjs','plugins/mochi-user-profile/holiday-greeting.mjs'],
 ['plugins/mochi-user-profile/index.mjs','plugins/mochi-user-profile/index.mjs'],
 ['client-plugins/jxl-brand/client.js','plugins/jxl-brand/client.js'],
 ['client-plugins/mochi-memory/client.js','plugins/mochi-memory-client/client.js'],
 ['apps/desktop/resources/mochi-web/runtime-profile.cjs','profile/runtime-profile.cjs'],
 ['plugins/mochi-llm-mimo/empty-reply-guard.mjs','plugins/mochi-llm-mimo/empty-reply-guard.mjs'],
];
const resources=files.map(([source,file])=>{
 const sourceSha256=digest(join(repo,source)),releaseSha256=digest(join(root(release),file)),installedSha256=digest(join(root(installed),file));
 assert.equal(releaseSha256,sourceSha256,'release differs from source: '+file);
 assert.equal(installedSha256,sourceSha256,'installed differs from source: '+file);
 return {source,file,sourceSha256,releaseSha256,installedSha256,match:true};
});
const textbooks=['teacher','classroom'].map(role=>{
 const home=join(homedir(),role==='teacher'?'.mochi-home':'.mochi-classroom-home'),knowledge=join(home,'knowledge'),database=join(knowledge,'textbook.sqlite');
 const db=new DatabaseSync(database,{readOnly:true});let totals,actualPages,statuses,bookRows;
 try{
  db.exec('PRAGMA query_only=ON');
  totals=db.prepare('SELECT COUNT(*) AS books,SUM(page_count) AS pages,SUM(text_layer_pages) AS textLayerPages,SUM(pending_ocr_pages) AS pendingOcrPages,SUM(unreadable_pages) AS unreadablePages FROM textbook_books').get();
  actualPages=db.prepare('SELECT COUNT(*) AS count FROM textbook_pages').get().count;
  statuses=db.prepare('SELECT text_status AS status,COUNT(*) AS count FROM textbook_pages GROUP BY text_status ORDER BY text_status').all();
  bookRows=db.prepare('SELECT id,library_file,source_sha256,page_count FROM textbook_books ORDER BY id').all();
 }finally{db.close();}
 assert.equal(totals.books,33,role+' books');assert.equal(totals.pages,4844,role+' metadata pages');assert.equal(actualPages,4844,role+' actual page rows');
 const skills=join(knowledge,'book-skills'),router=join(skills,'router/SKILL.md');assert.ok(existsSync(router),role+' router exists');
 const manifest=JSON.parse(readFileSync(join(skills,'textbook-skills.manifest.json'),'utf8'));assert.equal(manifest.books,33);assert.equal(manifest.pages,4844);
 // This mirrors the pinned public provider's one-level discovery scope, without reading bodies.
 const discoverable=readdirSync(skills,{withFileTypes:true}).filter(row=>row.isDirectory()&&existsSync(join(skills,row.name,'SKILL.md'))||row.isFile()&&row.name.endsWith('.md')&&!['README.md','LICENSE.book-to-skill.md'].includes(row.name)).map(row=>row.name).sort();
 assert.deepEqual(discoverable,['router'],role+' single skill router');
 const pdfs=bookRows.map(row=>{assert.match(row.library_file,/^tb-[a-f0-9]{64}\.pdf$/);const actualSha256=digest(join(knowledge,'library',row.library_file));assert.equal(actualSha256,row.source_sha256,role+' textbook PDF source integrity');return {bookId:row.id,pages:row.page_count,sha256:actualSha256};});
 return {role,home,database,readOnly:true,...totals,actualPages,pageStatuses:statuses,router:{path:router,sha256:digest(router),discoverable},skillManifest:{books:manifest.books,pages:manifest.pages,semanticDistillation:manifest.semanticDistillation,instructionScan:manifest.instructionScan},pdfs};
});
assert.equal(textbooks[0].router.sha256,textbooks[1].router.sha256,'role router byte equality');
assert.deepEqual(textbooks[0].pdfs,textbooks[1].pdfs,'role textbook source equality');
const evidence={verifiedAt:new Date().toISOString(),passed:true,scope:'source/release/installed key resources + read-only textbook metadata and PDF integrity',release,installed,resources,textbooks,guiVerified:false,guiBoundary:{normalUserWindowVerified:false,reportedBy:'root CUA delivery check',sameBundlePromoInstancePresent:true,launchServicesRoutingInferred:true,userDataLockConflictConfirmed:false,automaticReasoningSettingChanged:false,note:'Normal user GUI reopen was unavailable while another same-bundle promo instance remained running. No promo process was stopped and no shell GUI bypass was performed.'},paidModelCalls:0,credentialsRead:false,conversationsRead:false,roleHomeWrites:false};
writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log('PASS: '+resources.length+' key resource hashes source/release/installed; 2 role homes each 33 books/4844 pages; single router and 33 PDF hashes per role. GUI not tested.');console.log(output);
