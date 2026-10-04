import {installHolidayGreeting} from './holiday-greeting.mjs';
import {UserProfile,ProfileError,addressPrompt,productIdentityPrompt,currentProductIdentity} from './store.mjs';
export const name='mochi-user-profile';
export const inject=['connection','systemPrompt'];
export function apply(ctx,config={}){
 const profile=new UserProfile(config.role,config.dataRoot);
 if(typeof ctx.inject==='function')ctx.inject(['llm','agents','agentDefaultModel'],host=>installHolidayGreeting(host,profile));const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 const route=ctx.connection.fetch.register({path:'/api/mochi-profile',methods:['GET','PATCH'],requestBody:'buffered',fetch:async request=>{try{if(request.method==='GET')return json(profile.read());if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new ProfileError('INVALID_PROFILE',400);const raw=await request.text();if(Buffer.byteLength(raw)>2048)throw new ProfileError('INVALID_PROFILE',400);let body;try{body=JSON.parse(raw)}catch{throw new ProfileError('INVALID_PROFILE',400)}return json(profile.update(body))}catch(error){return json({code:error instanceof ProfileError?error.code:'PROFILE_UNAVAILABLE'},error instanceof ProfileError?error.status:503)}}});
 const identity=ctx.systemPrompt.section({name:'mochi:product-identity',order:(ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')??100)+1,interpolate:false,text:()=>productIdentityPrompt(config.role)});
 const currentIdentity=ctx.systemPrompt.context({name:'mochi:current-product-identity',order:1000,text:currentProductIdentity});
 const section=ctx.systemPrompt.section({name:'mochi:user-address',order:(ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')??100)+2,interpolate:false,text:()=>{try{return addressPrompt(profile.read())}catch{ctx.logger?.warn?.('Mochi user address is unavailable');return ''}}});
 ctx.effect(()=>()=>{route();identity();currentIdentity();section()});
}
