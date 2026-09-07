import { resolve } from 'node:path';
import { listenOfficeServer } from './server.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname);
const secret=process.env.MOCHI_OFFICE_JWT_SECRET;if(!secret)throw new Error('MOCHI_OFFICE_JWT_SECRET is required');
await listenOfficeServer({host:'127.0.0.1',port:18100,allowedRoot:resolve(root,'artifacts/migration-audit/teacher-documents'),versionRoot:resolve(root,'artifacts/migration-audit/office-versions'),documents:{'teacher-document-demo':'20260905T160420935Z-demonstration-structured-docx-pdf/document.docx'},jwtSecret:secret,engineOrigin:'http://127.0.0.1:18080',publicBaseUrl:process.env.MOCHI_OFFICE_PUBLIC_BASE_URL??'http://host.lima.internal:18100',callbackReachable:process.env.MOCHI_OFFICE_BRIDGE_VERIFIED==='true',documentServerOrigins:['http://127.0.0.1:18080','http://host.lima.internal:18080'],browserOrigins:['http://127.0.0.1:3090','http://localhost:3090','http://127.0.0.1:3094','http://localhost:3094']});
console.log('Mochi Office adapter listening on http://127.0.0.1:18100');
