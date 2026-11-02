# T08 내 소개 페이지에 패스키 달기 — 제출·재현 설명서

## 결과물과 소스
- 결과물: https://plan-do-see-t08-hongbin9305.vercel.app
- 소스: https://github.com/hongbin9305/My-introduction/tree/main/t08
- 최초 공개 소개 페이지: https://github.com/hongbin9305/My-introduction/blob/main/index.html
- T08는 최초 공개 소개 페이지 내용을 복제·유지하고 페이지 아래에만 비공개 작업실을 붙였다.

## ① 무엇으로 붙였나
WebAuthn(FIDO2) 기반 패스키를 사용했다. 브라우저 `@simplewebauthn/browser@13.2.2`, 서버 `@simplewebauthn/server@13.2.2` (Supabase Edge Function, Deno), Supabase PostgreSQL을 사용. 아이디는 가상의 테스트용 영문 별칭이며 **비밀번호를 전혀 생성하거나 입력하지 않는다**. 기기가 개인키를 보관하고 공개키(COSE)를 서버에 등록한다.

## ② 왜 그걸 골랐나
직접 암호서명 포맷/CBOR을 구현하는 대신, 널리 사용되는 WebAuthn 구현으로 서버 측 챌린지, RP ID, Origin, 사용자 확인(기기 PIN/생체인증), 서명을 검증하기 위해 선택했다. 공개 영역은 모두에게 열리고 인증 후 비공개 영역만 서버가 제공한다.

## ③ 어디를 어떻게 고쳤나
- 공개 영역/비공개 영역 UI: `t08/index.html`. 최초 소개 내용은 유지. 로그인 전 HTML에는 비공개 자료 본문이 없음.
- 등록: `t08/passkey.js`의 `register/options` → `startRegistration()` → `register/verify`; Edge Function `t08-passkeys/index.ts` (Supabase 프로젝트 서버 배포).
- 로그인: `login/options` → `startAuthentication()` → `login/verify`. 인증 성공 시 서버가 난수 토큰을 발급하고 DB에는 SHA-256 해시만 저장, 브라우저는 탭 sessionStorage에만 보관.
- 로그아웃: `logout`; 서버의 `t08_sessions.revoked=true` 갱신.
- 비공개 조회: `private`; 서버에서 세션 유효성을 검사하고 DB의 `t08_private.account_id`로 제한. HTML이나 JS 파일에 비공개 자료 본문을 넣지 않음.
- 패스키 목록/추가/삭제: `passkeys`, `add/options`, `add/verify`, `passkeys/delete`. 이름, 등록일, 공개키 일부만 표시. 마지막 패스키 삭제는 409로 거절.
- DB: `t08_accounts`, `t08_credentials`, `t08_challenges`, `t08_sessions`, `t08_private`. RLS 활성화, anon/authenticated GRANT 철회, Edge service_role만 DB 직접 접근.

## ④ 안 열리는 것을 확인한 기록

실제 HTTP 확인 (2026-11-02, HTTPS, Vercel 임시 테스트 함수에서 Supabase Edge Function으로 호출, 테스트 직후 임시 함수 제거):

| 요청 | 응답 |
|---|---|
| `POST /t08-passkeys {action:health}` | 200 / `ok:true` |
| `POST /t08-passkeys {action:private}` 인증 정보 없음 | 401 / `패스키 로그인 후 이용할 수 있습니다.` |
| `POST /t08-passkeys {action:register/options,handle:audit_demo}` 2회 | 200, 200 / 각 challenge 서로 다름(true) |
| `POST /t08-passkeys {action:register/verify, response:{id:tampered}}` | 400 / Credential ID was not base64url-encoded |
| 같은 challengeId로 `register/verify` 재전송 | 400 / 이미 사용됐거나 만료된 질문입니다. |
| 비로그인 `GET /` | 200, 공개 소개 및 잠금 UI 존재, 실제 비공개 본문 없음 |

패스키가 실제로 서명한 성공 로그인/실패 로그인, 로그인 challenge 재사용, A↔B 양방향 401/403, 두 개 등록 후 하나 삭제한 로그인은 **사용자 기기 인증이 아직 수행되지 않아 미검증**. 허위 증거를 기록하지 않는다. 인증 성공/실패와 공개키의 실물 결과는 등록 후 추가해야 한다.

## ⑤ AI와 나
- AI에게 맡긴 일: 기존 소개 페이지 보존, 공개/비공개 UI 분리, WebAuthn 라이브러리 연동, Supabase 서버와 DB 설계, Vercel 배포, 비로그인 401 및 챌린지 일회성 서버 검증.
- 내가 직접 판단한 일: 실제 개인정보를 넣지 않고 가상 자료 세 개(프로젝트 메모/지원 목표 목록/하루 회고)만 보호하며, 기존 소개를 누구에게나 공개하도록 요청했다.
- AI 제안을 따르지 않은 일: 별도 거부한 제안은 없었다. 대신 실제 기기의 패스키 생성과 본인 인증 승인은 AI에게 위임하지 않기로 했다.

## ⑥ 아직 못 막은 것
- 사용자 인증 수단이 모두 없어지면 별도의 계정 복구 절차가 없다. 이를 막기 위해 마지막 패스키 삭제는 서버에서 409로 거절하지만 **기기 두 개를 모두 실제 분실한 상황까지 복구하지는 못한다**.
- 별도 사용자별 속도 제한과 대량 시도 방지 기능이 아직 구현되지 않았다. 공개 등록/로그인 챌린지 엔드포인트에 Rate Limit 추가가 필요하다.
- 웹앱의 sessionStorage에 세션 토큰을 보관하므로, 동일 Origin에 XSS가 발생하면 토큰 탈취 위험이 있다. CSP/HttpOnly 쿠키 방식 개선 필요.

## 네 가지 짧은 확인 방법
1. 어디로 가나요: 위 HTTPS 결과물에 새 시크릿 창으로 접속한다.
2. 세 단계 안에 무엇을 하나요: 가상 사용자명 입력 → 패스키 등록 승인 → 로그아웃 후 같은 이름으로 패스키 로그인.
3. 통과하면 무엇이 보이나요: 인증 후만 샘플 개인 자료 3건, 패스키 목록 이름·등록일·공개키 일부가 표시됨.
4. 안 되면 무엇이 보이나요: 인증 없이 개인 데이터 요청은 401, 잘못된 챌린지 또는 서명은 400/403, 마지막 패스키 삭제는 409 및 안내.

## 실기기 시험 및 증빙 추가 요건
1. 가상 사용자 A의 첫 패스키 등록 및 기기 저장소(Windows Hello/휴대전화/Google Password Manager 등) 기록.
2. A의 두 번째 패스키를 다른 인증 수단으로 등록, 목록 2건 확인, 하나 삭제 후 남은 것으로 로그인, 지운 패스키 거절 증빙.
3. 가상 사용자 B를 별도 패스키로 등록하고 B 전용 데이터가 다름을 확인.
4. 로그인 챌린지 2회, 성공/실패/재사용, 로그아웃 후 구 토큰 거절, A↔B 타인 자료 양방향 거절 및 거절 전후 건수 불변을 HTTP 요청/응답(비밀값 가림)으로 기록.
5. 등록이 취소되면 서버에 공개키가 저장되지 않음을 확인.
