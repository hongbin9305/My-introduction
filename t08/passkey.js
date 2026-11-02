import {startRegistration,startAuthentication} from 'https://esm.sh/@simplewebauthn/browser@13.2.2?bundle';
const ENDPOINT='https://krgebzcfvgflrkjisaxd.supabase.co/functions/v1/t08-passkeys';
const el=id=>document.getElementById(id);
let token=sessionStorage.getItem('t08_token')||'';
let activeHandle=sessionStorage.getItem('t08_handle')||'';
const status=s=>el('vault-status').textContent=s;
async function api(action,data={}){
 const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...data}),cache:'no-store'});
 const answer=await r.json().catch(()=>({error:'서버 응답 형식 오류'}));
 if(!r.ok)throw Error('HTTP '+r.status+' · '+(answer.error||'요청 거절'));
 return answer;
}
async function work(fn){
 for(const b of document.querySelectorAll('#vault button'))b.disabled=true;
 try{await fn()}catch(e){if(e?.name==='NotAllowedError'){status('패스키 생성이 완료되지 않았습니다. 기존 패스키는 유지됩니다. 같은 Google 비밀번호 관리자에서 같은 계정의 중복 패스키가 거절될 수 있습니다. Windows Hello나 다른 패스키 저장소로 등록해 주세요. ('+e.name+')')}else{status(e.message||String(e))}}
 finally{for(const b of document.querySelectorAll('#vault button'))b.disabled=false}
}
function save(loginToken,handle){token=loginToken;activeHandle=handle;sessionStorage.setItem('t08_token',token);sessionStorage.setItem('t08_handle',handle)}
function clear(){token='';activeHandle='';sessionStorage.removeItem('t08_token');sessionStorage.removeItem('t08_handle')}
async function view(){
 if(!token){el('vault-unlocked').hidden=true;el('logout-passkey').hidden=true;return}
 const [privateData,keys]=await Promise.all([api('private'),api('passkeys')]);
 el('vault-unlocked').hidden=false;el('logout-passkey').hidden=false;el('login-handle').value=activeHandle;
 const list=el('vault-records');list.replaceChildren();
 for(const x of privateData.records){
  const box=document.createElement('article');box.className='vault-card';
  const h=document.createElement('h3');h.textContent=x.title;
  const p=document.createElement('p');p.textContent=x.body;box.append(h,p);list.append(box);
 }
 const keyList=el('vault-passkey-list');keyList.replaceChildren();
 for(const k of keys.passkeys){
  const li=document.createElement('li');li.textContent=k.nickname+' · 등록 '+new Date(k.created_at).toLocaleString('ko-KR')+' · 공개키: '+k.public_key.slice(0,28)+'… ';
  const button=document.createElement('button');button.type='button';button.textContent='이 패스키 삭제';button.className='vault-danger';button.disabled=keys.passkeys.length<2;
  button.onclick=()=>work(async()=>{if(!confirm(k.nickname+' 패스키의 서버 등록을 삭제할까요?'))return;await api('passkeys/delete',{id:k.id});status('등록된 패스키를 삭제했습니다. 삭제된 패스키는 다시 로그인에 사용할 수 없습니다.');await view()});
  li.append(button);keyList.append(li);
 }
 status('패스키 로그인 성공: '+activeHandle+' 계정. 비공개 샘플 '+privateData.records.length+'개를 서버에서 불러왔습니다.');
}
el('register-passkey').onclick=()=>work(async()=>{
 const handle=el('reg-handle').value.trim().toLowerCase(),nickname=el('reg-nickname').value.trim()||'첫 번째 패스키';
 const x=await api('register/options',{handle});
 status('기기가 패스키를 생성할 수 있도록 승인해 주세요.');
 const credential=await startRegistration({optionsJSON:x.options});
 const y=await api('register/verify',{handle,challengeId:x.challengeId,response:credential,nickname});
 if(!y.verified)throw Error('패스키 등록 실패');
 save(y.token,handle);await view();
});
el('login-passkey').onclick=()=>work(async()=>{
 const handle=el('login-handle').value.trim().toLowerCase(),x=await api('login/options',{handle});
 status('기기에서 지문·PIN·보안 키 인증을 완료해 주세요.');
 const credential=await startAuthentication({optionsJSON:x.options});
 const y=await api('login/verify',{handle,challengeId:x.challengeId,response:credential});
 if(!y.verified)throw Error('서명 검증 실패');
 save(y.token,handle);await view();
});
el('add-passkey').onclick=()=>work(async()=>{
 const x=await api('add/options'),nickname=el('extra-nickname').value.trim()||'추가 패스키';
 status('두 번째 패스키를 사용할 기기를 선택해 승인해 주세요.');
 const credential=await startRegistration({optionsJSON:x.options});
 const y=await api('add/verify',{handle:activeHandle,challengeId:x.challengeId,response:credential,nickname});
 if(!y.verified)throw Error('추가 패스키 확인 실패');
 await view();
});
el('logout-passkey').onclick=()=>work(async()=>{
 await api('logout');clear();await view();status('로그아웃했습니다. 이전 세션은 서버에서 폐기되어 재사용할 수 없습니다.');
});
if(!window.PublicKeyCredential)status('이 브라우저는 패스키를 지원하지 않습니다. 최신 Chrome/Edge 및 Windows Hello나 휴대전화 패스키를 사용해 주세요.');
else if(token)view().catch(()=>{clear();view();status('이전 로그인 세션이 만료되어 다시 패스키 로그인이 필요합니다.')});
