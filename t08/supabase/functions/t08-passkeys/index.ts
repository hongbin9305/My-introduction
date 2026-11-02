import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from 'npm:@simplewebauthn/server@13.2.2';
const ROOT='https://plan-do-see-t08-hongbin9305.vercel.app';
const RP='plan-do-see-t08-hongbin9305.vercel.app';
const CORS={'Access-Control-Allow-Origin':ROOT,'Access-Control-Allow-Headers':'content-type,authorization,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const respond=(status,value)=>new Response(JSON.stringify(value),{status,headers:{...CORS,'Content-Type':'application/json'}});
const enc=(a)=>{let s='';for(const n of a)s+=String.fromCharCode(n);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')};
const dec=(s)=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const hash=async(s)=>enc(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
const random=()=>enc(crypto.getRandomValues(new Uint8Array(32)));
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{autoRefreshToken:false,persistSession:false}});
async function account(req){
 const token=(req.headers.get('authorization')||'').match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
 if(!token)return null;
 const {data:r}=await db.from('t08_sessions').select('account_id,expires_at,revoked').eq('token_hash',await hash(token)).maybeSingle();
 if(!r||r.revoked||new Date(r.expires_at).getTime()<=Date.now())return null;
 return {id:r.account_id,token};
}
async function session(account_id){
 const token=random();const {error}=await db.from('t08_sessions').insert({account_id,token_hash:await hash(token)});
 if(error)throw new Error('세션 발급 실패');
 return token;
}
async function claim(id,kind,handle){
 const {data,error}=await db.from('t08_challenges').update({used:true}).eq('id',id).eq('kind',kind).eq('handle',handle).eq('used',false).gt('expires_at',new Date().toISOString()).select('id,challenge,account_id').maybeSingle();
 if(error||!data)throw new Error('이미 사용됐거나 만료된 질문입니다.');
 return data;
}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(req.headers.get('origin')!==ROOT)return respond(403,{error:'허용되지 않은 출처'});
 if(req.method!=='POST')return respond(405,{error:'POST only'});
 try{
 const {action,...b}=await req.json();
 const me=await account(req);
 if(action==='health')return respond(200,{ok:true,mode:'WebAuthn passkey'});
 if(action==='pair/start'){
  if(!me)return respond(401,{error:'먼저 PC에서 패스키 로그인하세요.'});
  const ticket=random();
  const {error}=await db.from('t08_pair_tickets').insert({token_hash:await hash(ticket),account_id:me.id});
  if(error)throw new Error('기기 연결 코드 발급 실패');
  return respond(200,{ticket,expiresInSeconds:600});
 }
 if(action==='pair/options'){
  const ticket=String(b.ticket||'');
  if(!/^[A-Za-z0-9_-]{40,80}$/.test(ticket))return respond(401,{error:'연결 코드가 올바르지 않습니다.'});
  const {data:t}=await db.from('t08_pair_tickets').select('account_id,expires_at,used').eq('token_hash',await hash(ticket)).maybeSingle();
  if(!t||t.used||Date.parse(t.expires_at)<=Date.now())return respond(401,{error:'연결 코드가 만료됐거나 사용됐습니다.'});
  const {data:a}=await db.from('t08_accounts').select('handle').eq('id',t.account_id).single();
  if(!a)return respond(404,{error:'계정을 찾을 수 없습니다.'});
  const {data:keys}=await db.from('t08_credentials').select('id,transports').eq('account_id',t.account_id);
  const options=await generateRegistrationOptions({rpName:'ALEPH T08 Passkey',rpID:RP,userName:a.handle,userDisplayName:a.handle,userID:crypto.getRandomValues(new Uint8Array(32)),attestationType:'none',authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'},excludeCredentials:(keys||[]).map(x=>({id:x.id,transports:x.transports||[]}))});
  const {data:ch,error}=await db.from('t08_challenges').insert({account_id:t.account_id,handle:a.handle,kind:'add',challenge:options.challenge}).select('id').single();
  if(error)throw new Error('패스키 질문 발급 실패');
  return respond(200,{challengeId:ch.id,options,handle:a.handle});
 }
 if(action==='pair/verify'){
  const ticket=String(b.ticket||'');
  if(!/^[A-Za-z0-9_-]{40,80}$/.test(ticket))return respond(401,{error:'연결 코드 오류'});
  const tokenHash=await hash(ticket);
  const {data:t}=await db.from('t08_pair_tickets').update({used:true}).eq('token_hash',tokenHash).eq('used',false).gt('expires_at',new Date().toISOString()).select('account_id').maybeSingle();
  if(!t)return respond(401,{error:'연결 코드 재사용 또는 만료'});
  const {data:a}=await db.from('t08_accounts').select('handle').eq('id',t.account_id).single();
  if(!a)return respond(404,{error:'사용자를 찾을 수 없습니다.'});
  const ch=await claim(String(b.challengeId||''),'add',a.handle);
  if(ch.account_id!==t.account_id)return respond(403,{error:'다른 계정의 질문입니다.'});
  const check=await verifyRegistrationResponse({response:b.response,expectedChallenge:ch.challenge,expectedOrigin:ROOT,expectedRPID:RP,requireUserVerification:true});
  if(!check.verified||!check.registrationInfo)return respond(403,{error:'패스키 등록 거절'});
  const k=check.registrationInfo.credential;
  const {error}=await db.from('t08_credentials').insert({id:k.id,account_id:t.account_id,public_key:enc(k.publicKey),counter:k.counter,transports:k.transports||[],nickname:'iPhone 패스키'});
  if(error)throw new Error('공개키 저장 실패');
  return respond(200,{verified:true,nickname:'iPhone 패스키'});
 }
 if(action==='register/options'||action==='add/options'){
  if(action==='add/options'&&!me)return respond(401,{error:'패스키 로그인 필요'});
  const handle=action==='add/options'?(await db.from('t08_accounts').select('handle').eq('id',me.id).single()).data?.handle:String(b.handle||'').trim().toLowerCase();
  if(!/^[a-z0-9_-]{3,24}$/.test(handle))return respond(400,{error:'영문 소문자·숫자 3~24자'});
  const {data:existing}=await db.from('t08_accounts').select('id').eq('handle',handle).maybeSingle();
  if(action==='register/options'&&existing)return respond(409,{error:'이미 등록된 사용자명입니다. 로그인하세요.'});
  if(action==='add/options'&&existing?.id!==me.id)return respond(403,{error:'다른 계정'});
  const {data:keys}=action==='add/options'?await db.from('t08_credentials').select('id,transports').eq('account_id',me.id):{data:[]};
  const options=await generateRegistrationOptions({rpName:'ALEPH T08 Passkey',rpID:RP,userName:handle,userDisplayName:handle,userID:crypto.getRandomValues(new Uint8Array(32)),attestationType:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'required'},excludeCredentials:(keys||[]).map(x=>({id:x.id,transports:x.transports||[]}))});
  const {data,error}=await db.from('t08_challenges').insert({handle,kind:action.startsWith('add')?'add':'register',account_id:me?.id||null,challenge:options.challenge}).select('id').single();
  if(error)throw new Error('질문 발급 실패');
  return respond(200,{challengeId:data.id,options});
 }
 if(action==='register/verify'||action==='add/verify'){
  const kind=action==='add/verify'?'add':'register';
  if(kind==='add'&&!me)return respond(401,{error:'패스키 로그인 필요'});
  const handle=String(b.handle||'').trim().toLowerCase();
  const ch=await claim(String(b.challengeId||''),kind,handle);
  if(kind==='add'&&ch.account_id!==me.id)return respond(403,{error:'다른 사용자'});
  const check=await verifyRegistrationResponse({response:b.response,expectedChallenge:ch.challenge,expectedOrigin:ROOT,expectedRPID:RP,requireUserVerification:true});
  if(!check.verified||!check.registrationInfo)return respond(403,{error:'공개키 등록 검증 실패'});
  let owner=me?.id;
  if(kind==='register'){
   const {data:created,error}=await db.from('t08_accounts').insert({handle}).select('id').single();
   if(error)return respond(409,{error:'이미 등록된 사용자명입니다.'});
   owner=created.id;
  }
  const k=check.registrationInfo.credential;
  const {error}=await db.from('t08_credentials').insert({id:k.id,account_id:owner,public_key:enc(k.publicKey),counter:k.counter,transports:k.transports||[],nickname:String(b.nickname||'내 패스키').slice(0,48)});
  if(error)throw new Error('공개키 저장 실패');
  if(kind==='register'){
   const names=['프로젝트 메모','지원 목표 목록','하루 회고'];
   const samples=['가상의 개인 프로젝트: 네트워크 분리 및 접근 제어 검토','가상의 지원 기업: 샘플 A, 샘플 B, 샘플 C','가상의 회고: 작은 목표를 정하고 실행 결과를 기록'];
   const {error:pe}=await db.from('t08_private').insert(names.map((title,i)=>({account_id:owner,title,body:samples[i]+' / 테스트용 계정 '+handle})));
   if(pe)throw new Error('샘플 생성 실패');
  }
  return respond(200,{verified:true,token:kind==='register'?await session(owner):undefined,credential:{id:k.id,nickname:String(b.nickname||'내 패스키').slice(0,48)}});
 }
 if(action==='login/options'){
  const handle=String(b.handle||'').trim().toLowerCase();
  const {data:who}=await db.from('t08_accounts').select('id').eq('handle',handle).maybeSingle();
  if(!who)return respond(401,{error:'등록된 패스키를 찾을 수 없습니다.'});
  const {data:keys}=await db.from('t08_credentials').select('id,transports').eq('account_id',who.id);
  if(!keys?.length)return respond(401,{error:'등록된 패스키가 없습니다.'});
  const options=await generateAuthenticationOptions({rpID:RP,...(b.discoverable?{}:{allowCredentials:keys.map(x=>({id:x.id,transports:x.transports||[]}))}),userVerification:'required'});
  const {data,error}=await db.from('t08_challenges').insert({account_id:who.id,handle,kind:'login',challenge:options.challenge}).select('id').single();
  if(error)throw new Error('질문 발급 실패');
  return respond(200,{challengeId:data.id,options});
 }
 if(action==='login/verify'){
  const handle=String(b.handle||'').trim().toLowerCase();
  const ch=await claim(String(b.challengeId||''),'login',handle);
  const {data:key}=await db.from('t08_credentials').select('id,public_key,counter,transports,account_id').eq('id',b.response?.id||'').eq('account_id',ch.account_id).maybeSingle();
  if(!key)return respond(403,{error:'이 계정에 등록되지 않은 패스키입니다.'});
  const check=await verifyAuthenticationResponse({response:b.response,expectedChallenge:ch.challenge,expectedOrigin:ROOT,expectedRPID:RP,credential:{id:key.id,publicKey:dec(key.public_key),counter:Number(key.counter),transports:key.transports||[]},requireUserVerification:true});
  if(!check.verified)return respond(403,{error:'서명 확인 실패'});
  await db.from('t08_credentials').update({counter:check.authenticationInfo.newCounter}).eq('id',key.id);
  return respond(200,{verified:true,token:await session(ch.account_id)});
 }
 if(!me)return respond(401,{error:'패스키 로그인 후 이용할 수 있습니다.'});
 if(action==='private'){
  const {data,error}=await db.from('t08_private').select('id,title,body').eq('account_id',me.id).order('created_at');
  if(error)throw new Error('조회 실패');
  return respond(200,{records:data||[]});
 }
 if(action==='passkeys'){
  const {data}=await db.from('t08_credentials').select('id,nickname,created_at,public_key').eq('account_id',me.id).order('created_at');
  return respond(200,{passkeys:(data||[]).map(k=>({id:k.id,nickname:k.nickname,created_at:k.created_at,public_key:k.public_key}))});
 }
 if(action==='passkeys/delete'){
  const {data:ks}=await db.from('t08_credentials').select('id').eq('account_id',me.id);
  if((ks||[]).length<=1)return respond(409,{error:'마지막 패스키는 삭제할 수 없습니다. 새 패스키를 먼저 등록하세요.'});
  const {data:deleted}=await db.from('t08_credentials').delete().eq('account_id',me.id).eq('id',String(b.id||'')).select('id');
  if(!deleted?.length)return respond(404,{error:'내 패스키를 찾을 수 없습니다.'});
  return respond(200,{deleted:true});
 }
 if(action==='logout'){
  await db.from('t08_sessions').update({revoked:true}).eq('token_hash',await hash(me.token));
  return respond(200,{loggedOut:true});
 }
 return respond(404,{error:'unknown action'});
 }catch(e){return respond(400,{error:String(e?.message||'요청 오류').slice(0,160)})}
});
