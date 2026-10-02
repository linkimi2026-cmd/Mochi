import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const base = resolve(dir, '../v9/private.nosync');
const identityKeys = ['endpointId', 'role', 'schoolId', 'classId', 'displayName', 'fingerprint'];
const pick = (row, keys) => Object.fromEntries(keys.filter(key => row?.[key] !== undefined).map(key => [key, row[key]]));
const publicIdentity = row => pick(row, identityKeys);
const messageKeys = ['messageId', 'contentType', 'body', 'request', 'response', 'directive', 'delivery', 'receivedAt', 'createdAt', 'updatedAt', 'seenAt', 'seenReceipt', 'targetEndpointId'];
function message(row) {
  const result = pick(row, messageKeys);
  for (const key of ['from', 'recipient', 'sender', 'peer']) if (row[key]) result[key] = publicIdentity(row[key]);
  // No pairing secrets, private keys, signatures, envelopes or filesystem paths go to browser assets.
  return result;
}
function load(role, home) {
  const path = resolve(base, home, 'mochi-lan/mochi-lan/state.json');
  const bytes = readFileSync(path);
  const state = JSON.parse(bytes);
  if (state.identity.role !== role || state.identity.schoolId !== 'mochi-promo-demo') throw Error('Expected isolated promo identity');
  return {
    source: {path, sha256: createHash('sha256').update(bytes).digest('hex')},
    snapshot: {
      configured: true, lockedRole: role, identity: publicIdentity(state.identity),
      peers: Object.values(state.pairings).map(row => ({identity: publicIdentity(row.peer), blocked: !!state.blocked[row.peer.endpointId]})),
      inbox: Object.values(state.inbox).map(message), outbox: Object.values(state.outbox).map(message),
      receipts: Object.values(state.receipts).map(row => ({...pick(row, ['messageId', 'seenAt', 'receivedAt', 'updatedAt']), from: publicIdentity(row.from)})),
    },
  };
}
const teacher = load('teacher', 'home');
const classroom = load('classroom', 'classroom-home');
const verified = teacher.snapshot.outbox.map(sent => {
  const received = classroom.snapshot.inbox.find(row => row.messageId === sent.messageId);
  const receipt = teacher.snapshot.receipts.find(row => row.messageId === sent.messageId && row.from.endpointId === classroom.snapshot.identity.endpointId && row.from.fingerprint === classroom.snapshot.identity.fingerprint);
  return {
    messageId: sent.messageId,
    kind: sent.directive ? 'student-call' : sent.response ? 'appointment-response' : 'notification',
    sentAcknowledged: sent.delivery === 'ACKNOWLEDGED',
    matchingReceiver: !!received && received.from.endpointId === teacher.snapshot.identity.endpointId && received.from.fingerprint === teacher.snapshot.identity.fingerprint && received.recipient.endpointId === classroom.snapshot.identity.endpointId,
    bodyMatches: !!received && received.body === sent.body,
    receiverSeen: received?.seenReceipt === 'ACKNOWLEDGED' && !!received?.seenAt,
    matchingSeenReceipt: !!receipt && receipt.seenAt === received?.seenAt,
  };
});
mkdirSync(resolve(dir, 'evidence-private.nosync'), {recursive: true});
writeFileSync(resolve(dir, 'evidence-private.nosync/lan-records.json'), JSON.stringify({teacher, classroom}, null, 2));
writeFileSync(resolve(dir, 'lan-evidence-report.json'), JSON.stringify({scope: 'Persisted isolated demo records, not new recording or current network health', verified}, null, 2) + '\n');
console.log(JSON.stringify(verified, null, 2));
