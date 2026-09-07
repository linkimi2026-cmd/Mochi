import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { documentKey, OfficeVersionStore, pathIsInside, verifyJwt } from '../index.mjs';

const secret='test-only-secret-with-32-characters';
const enc=(v)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const token=(payload)=>{const h=enc({alg:'HS256',typ:'JWT'}),p=enc(payload); return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;};

test('Windows allowlist containment accepts children and rejects prefixes and other drives',()=>{
 assert.equal(pathIsInside('C:\\Mochi\\docs','C:\\Mochi\\docs\\lesson.docx',win32),true);
 assert.equal(pathIsInside('C:\\Mochi\\docs','C:\\Mochi\\docs-old\\lesson.docx',win32),false);
 assert.equal(pathIsInside('C:\\Mochi\\docs','D:\\Mochi\\docs\\lesson.docx',win32),false);
});

test('signed final callback saves a new copy and duplicate callback is idempotent', async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'mochi-office-')); t.after(()=>rm(root,{recursive:true,force:true})); await mkdir(join(root,'allowed')); await writeFile(join(root,'allowed','demo.docx'),'original');
 let downloads=0; const server=createServer((_q,r)=>{downloads+=1;if(downloads>1){r.statusCode=404;return r.end('expired');}r.setHeader('content-length','6');r.end('edited')}); await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r))); const origin=`http://127.0.0.1:${server.address().port}`;
 const store=new OfficeVersionStore({allowedRoot:join(root,'allowed'),versionRoot:join(root,'versions'),documents:{demo:'demo.docx'},jwtSecret:secret,documentServerOrigins:[origin]});
 const payload={key:documentKey('demo','a'.repeat(64)),status:2,url:`${origin}/saved`}; const body=Buffer.from(JSON.stringify(payload)); const authorization=`Bearer ${token(payload)}`;
 const first=await store.saveCallback({authorization,body}); assert.equal(first.saved,true); assert.equal(await readFile(first.path,'utf8'),'edited'); assert.equal(await readFile(join(root,'allowed','demo.docx'),'utf8'),'original');
 assert.deepEqual(await store.saveCallback({authorization,body}),{error:0,saved:false,duplicate:true});
 assert.equal(downloads,1,'a successful callback replay must not reuse an expired download URL');
});

test('allowlist, origin, signature, and non-save status fail closed', async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'mochi-office-')); t.after(()=>rm(root,{recursive:true,force:true})); await mkdir(join(root,'allowed')); await writeFile(join(root,'allowed','demo.docx'),'original');
 const store=new OfficeVersionStore({allowedRoot:join(root,'allowed'),versionRoot:join(root,'versions'),documents:{demo:'demo.docx'},jwtSecret:secret,documentServerOrigins:['http://127.0.0.1:1']});
 await assert.rejects(()=>store.source('unknown'),e=>e.code==='OFFICE_DOCUMENT_DENIED'); assert.throws(()=>verifyJwt(`${token({a:1})}x`,secret),e=>e.code==='OFFICE_JWT_INVALID');
 const idle={key:documentKey('demo','a'.repeat(64)),status:1}; assert.deepEqual(await store.saveCallback({authorization:`Bearer ${token(idle)}`,body:Buffer.from(JSON.stringify(idle))}),{error:0,saved:false});
 const bad={key:documentKey('demo','a'.repeat(64)),status:2,url:'https://evil.example/file'}; await assert.rejects(()=>store.saveCallback({authorization:`Bearer ${token(bad)}`,body:Buffer.from(JSON.stringify(bad))}),e=>e.code==='OFFICE_CALLBACK_ORIGIN_DENIED');
 const wrong={key:documentKey('demo','a'.repeat(64)),status:1}; await assert.rejects(()=>store.saveCallback({authorization:`Bearer ${token(wrong)}`,body:Buffer.from('{}'),expectedId:'other'}),e=>e.code==='OFFICE_JWT_MISMATCH');
});

test('parent symlinks cannot escape the allowlist and unsafe IDs are rejected',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'mochi-office-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'allowed'));await mkdir(join(root,'outside'));await writeFile(join(root,'outside','secret.docx'),'secret');await symlink(join(root,'outside'),join(root,'allowed','escape'));
 const store=new OfficeVersionStore({allowedRoot:join(root,'allowed'),versionRoot:join(root,'versions'),documents:{demo:'escape/secret.docx'},jwtSecret:secret,documentServerOrigins:[]});
 await assert.rejects(()=>store.source('demo'),e=>e.code==='OFFICE_DOCUMENT_DENIED');
 assert.throws(()=>new OfficeVersionStore({allowedRoot:root,versionRoot:root,documents:{'../bad':'x.docx'},jwtSecret:secret,documentServerOrigins:[]}),e=>e.code==='OFFICE_DOCUMENT_DENIED');
});
