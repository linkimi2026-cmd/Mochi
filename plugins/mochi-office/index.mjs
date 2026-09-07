import { createHmac, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative as relativePath, resolve, sep } from 'node:path';

const MAX_CALLBACK = 64 * 1024; const MAX_DOCUMENT = 50 * 1024 * 1024; const TYPES = new Set(['.docx', '.xlsx', '.pptx']);
function fail(code, message) { const error = new Error(message); error.code = code; return error; }
const b64 = (v) => Buffer.from(v.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
export function pathIsInside(root, target, pathApi = { relative: relativePath, isAbsolute, sep }) {
  const relative = pathApi.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}
export function signJwt(payload, secret) { if (typeof secret !== 'string' || secret.length < 24) throw fail('OFFICE_JWT_INVALID','JWT secret must contain at least 24 characters'); const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'); const body=Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${head}.${body}.${createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`; }
export function documentKey(id, sha256) { return `mochi.${Buffer.from(id).toString('base64url')}.${sha256.slice(0,32)}`; }
export function documentIdFromKey(key) { const match=/^mochi\.([A-Za-z0-9_-]+)\.[a-f0-9]{32}$/.exec(key??''); if(!match)return undefined; try{return Buffer.from(match[1],'base64url').toString('utf8');}catch{return undefined;} }
export function verifyJwt(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 24) throw fail('OFFICE_JWT_INVALID', 'callback JWT or secret is invalid');
  const parts = token.split('.'); if (parts.length !== 3) throw fail('OFFICE_JWT_INVALID', 'callback JWT is malformed');
  let header, payload; try { header = JSON.parse(b64(parts[0])); payload = JSON.parse(b64(parts[1])); } catch { throw fail('OFFICE_JWT_INVALID', 'callback JWT is malformed'); }
  if (header.alg !== 'HS256') throw fail('OFFICE_JWT_INVALID', 'callback JWT algorithm is not allowed');
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest(); const actual = b64(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw fail('OFFICE_JWT_INVALID', 'callback JWT signature is invalid');
  return payload;
}
async function boundedDownload(url, { allowedOrigins, signal, timeoutMs = 15_000 }) {
  const parsed = new URL(url); if (!allowedOrigins.has(parsed.origin)) throw fail('OFFICE_CALLBACK_ORIGIN_DENIED', 'saved document origin is not allowed');
  const timeout = AbortSignal.timeout(timeoutMs); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(parsed, { signal: combined, redirect: 'error', headers: { accept: 'application/octet-stream' } });
  if (!response.ok) throw fail('OFFICE_DOWNLOAD_FAILED', `saved document returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length')); if (declared > MAX_DOCUMENT) { await response.body?.cancel(); throw fail('OFFICE_DOCUMENT_TOO_LARGE', 'saved document exceeds 50 MiB'); }
  const chunks=[]; let size=0; for await (const chunk of response.body) { size += chunk.length; if (size > MAX_DOCUMENT) throw fail('OFFICE_DOCUMENT_TOO_LARGE', 'saved document exceeds 50 MiB'); chunks.push(chunk); } return Buffer.concat(chunks);
}
export class OfficeVersionStore {
  constructor({ allowedRoot, versionRoot, documents, jwtSecret, documentServerOrigins }) {
    this.allowedRoot=resolve(allowedRoot); this.versionRoot=resolve(versionRoot); this.documents=new Map(Object.entries(documents ?? {})); this.jwtSecret=jwtSecret; this.allowedOrigins=new Set(documentServerOrigins ?? []); this.inFlight=new Map();
    for(const id of this.documents.keys())if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw fail('OFFICE_DOCUMENT_DENIED','document IDs must be path-safe');
  }
  async source(id) {
    const relative=this.documents.get(id); if (typeof relative !== 'string' || relative.includes('\0')) throw fail('OFFICE_DOCUMENT_DENIED', 'document is not allowlisted');
    const path=resolve(this.allowedRoot, relative); if (!TYPES.has(extname(path).toLowerCase())) throw fail('OFFICE_DOCUMENT_DENIED', 'document has an unsupported type');
    const [rootReal,pathReal]=await Promise.all([realpath(this.allowedRoot),realpath(path)]); if(!pathIsInside(rootReal,pathReal))throw fail('OFFICE_DOCUMENT_DENIED','document escapes the allowlist root');
    const info=await lstat(pathReal); if (!info.isFile() || info.isSymbolicLink()) throw fail('OFFICE_DOCUMENT_DENIED', 'document must be a regular allowlisted file'); return pathReal;
  }
  async versions(id) { await this.source(id); const dir=join(this.versionRoot,id); let names=[]; try { names=await readdir(dir); } catch(e) { if(e.code!=='ENOENT') throw e; } return names.filter(n=>/^v\d{4}\.(docx|xlsx|pptx)$/.test(n)).sort().map(name=>({version:Number(name.slice(1,5)),name,path:join(dir,name)})); }
  async current(id) { const versions=await this.versions(id); return versions.length ? versions.at(-1).path : this.source(id); }
  async atVersion(id,version) { if(version===0)return this.source(id); const found=(await this.versions(id)).find(item=>item.version===version); if(!found)throw fail('OFFICE_DOCUMENT_DENIED','document version does not exist'); return found.path; }
  async saveCallback({ authorization, body, signal, expectedId }) {
    if (!Buffer.isBuffer(body) || body.length > MAX_CALLBACK) throw fail('OFFICE_CALLBACK_TOO_LARGE', 'callback exceeds 64 KiB');
    const outer=JSON.parse(body.toString('utf8')); const bearer=/^Bearer (.+)$/.exec(authorization ?? '')?.[1]; const callback=verifyJwt(bearer ?? outer.token, this.jwtSecret);
    if(typeof callback.key!=='string'||!Number.isSafeInteger(callback.status))throw fail('OFFICE_JWT_INVALID','signed callback is incomplete'); if(expectedId!==undefined&&documentIdFromKey(callback.key)!==expectedId)throw fail('OFFICE_JWT_MISMATCH','signed callback key does not match the route');
    if (![2,6].includes(callback.status)) return { error:0, saved:false }; if(typeof callback.url!=='string')throw fail('OFFICE_JWT_INVALID','signed save callback has no URL');
    const documentId=documentIdFromKey(callback.key); await this.source(documentId);
    const ext=extname(this.documents.get(documentId)).toLowerCase(); const dir=join(this.versionRoot,documentId); await mkdir(dir,{recursive:true});
    const receipt=createHash('sha256').update(JSON.stringify(callback)).digest('hex'); const receiptPath=join(dir,`.${receipt}.saved`);
    try { await lstat(receiptPath); return {error:0,saved:false,duplicate:true}; } catch(e) { if(e.code!=='ENOENT')throw e; }
    if(this.inFlight.has(receipt)){await this.inFlight.get(receipt);return {error:0,saved:false,duplicate:true};}
    const operation=(async()=>{const bytes=await boundedDownload(callback.url,{allowedOrigins:this.allowedOrigins,signal});for(let version=1;version<=9999;version+=1){const path=join(dir,`v${String(version).padStart(4,'0')}${ext}`),temp=join(dir,`.${randomUUID()}.tmp`);await writeFile(temp,bytes,{flag:'wx',mode:0o600});try{await link(temp,path);}catch(error){await rm(temp,{force:true});if(error.code==='EEXIST')continue;throw error;}await rm(temp);try{await writeFile(receiptPath,path,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST'){await rm(path,{force:true});return {error:0,saved:false,duplicate:true};}await rm(path,{force:true});throw error;}return {error:0,saved:true,version,path};}throw fail('OFFICE_VERSION_LIMIT','document version limit reached');})();
    this.inFlight.set(receipt,operation);try{return await operation;}finally{this.inFlight.delete(receipt);}
  }
}
