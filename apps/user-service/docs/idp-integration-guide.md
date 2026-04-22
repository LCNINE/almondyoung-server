# user-service를 IdP로 연동하는 법

almondyoung `user-service`는 **PKCE 기반 OAuth 2.0 Authorization Code Flow**를 제공하는 IdP입니다. 로그인 UI는 `auth-web`이 담당하고, `user-service`는 코드 발급/토큰 교환/userinfo 엔드포인트를 제공합니다.

## 1. 사전 등록 (인프라 담당에게 요청)

아래 값을 받아두세요. `user-service`의 `OAUTH_CLIENTS` 환경변수에 등록되어야 합니다.

- `clientId` — 너희 앱 식별자
- `clientSecret` — 평문 (서버에서만 보관, 절대 브라우저에 노출 금지)
- `redirectUris` — 콜백으로 사용할 URL 전체 목록 (쿼리/해시 제외 완전 일치 검증)
- `allowedScopes` (선택)

## 2. 엔드포인트

| 용도 | Method | URL |
|------|--------|-----|
| 로그인 페이지 / authorize | GET | `https://<auth-web>/oauth/authorize` |
| 토큰 교환 / 리프레시 | POST | `https://<user-service>/oauth/token` |
| userinfo | GET | `https://<user-service>/oauth/userinfo` |
| 토큰 폐기 (RFC 7009) | POST | `https://<user-service>/oauth/revoke` |

## 3. 로그인 플로우

### (1) Authorize 리다이렉트 (브라우저)

사용자를 `auth-web`의 authorize 페이지로 보냅니다. PKCE는 **필수 (S256만 허용)**.

```
GET https://<auth-web>/oauth/authorize?
  response_type=code
  &client_id=<clientId>
  &redirect_uri=<registered redirect_uri>
  &state=<CSRF 토큰>
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256
  &scope=<선택>
```

- `code_verifier`는 43~128자 랜덤, 서버 세션/쿠키에 보관.
- 미로그인 상태면 `auth-web`이 로그인 UI로 보낸 뒤 자동으로 이 URL로 복귀.

### (2) Callback 수신

`redirect_uri`로 `?code=...&state=...`가 돌아옵니다. `state` 검증 필수.

### (3) Token 교환 (서버 → user-service, JSON)

```http
POST /oauth/token
Content-Type: application/json

{
  "grantType": "authorization_code",
  "clientId": "<clientId>",
  "clientSecret": "<clientSecret>",
  "code": "<받은 code>",
  "codeVerifier": "<(1)에서 저장한 verifier>",
  "redirectUri": "<(1)과 동일>"
}
```

응답:

```json
{
  "accessToken": "<JWT>",
  "refreshToken": "<opaque>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "scope": "..."
}
```

- **코드 TTL 60초, 1회용** (재사용 시 에러).
- `redirectUri`는 (1)과 바이트 단위로 일치해야 함.
- 필드명은 snake_case가 아닌 **camelCase** (`grantType`, `clientId`, `codeVerifier`, `redirectUri`).

### (4) Refresh

```json
POST /oauth/token
{
  "grantType": "refresh_token",
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "<이전 refresh>"
}
```

- **Rotation 적용**: 매번 새 refresh가 발급되고 이전 것은 즉시 폐기.
- 이미 폐기된 토큰을 재사용하면 **같은 체인 전체가 revoke**됨 → 반드시 최신 것만 저장.
- Access 15분, Refresh 90일.

### (5) Revoke (로그아웃 시)

```json
POST /oauth/revoke
{ "clientId": "...", "clientSecret": "...", "token": "<refresh>" }
```

## 4. Access Token 검증

Access Token은 JWT입니다. 두 가지 옵션:

- **권장**: `GET /oauth/userinfo` 호출 (`Authorization: Bearer <accessToken>`). 응답:
  ```json
  { "sub": "<userId:UUID>", "email": "...", "nickname": "...", "username": "..." }
  ```
- 로컬 JWT 검증이 필요하면 `AUTH_SECRET` (HS256 공유키)을 인프라에서 받아 `sub`, `client_id`, `scope`, `exp` 확인. 키 공유가 꺼려지면 userinfo만 쓰세요.

## 5. 보안 체크리스트

- `clientSecret`, `code_verifier`, `refreshToken`은 **서버에서만** 취급. 브라우저로 내려보내지 말 것.
- `state`를 세션에 묶어 CSRF 방어.
- `redirect_uri`는 정확히 등록된 값과 일치해야 함 (쿼리 추가 금지).
- 토큰 저장은 httpOnly + Secure + SameSite=Lax 쿠키 권장.
- 시계 오차에 대비해 refresh는 만료 1분 전쯤 선제 갱신.

## 6. 에러 매핑

- 404: `unknown client` / `user not found`
- 401: `invalid client_secret` / `invalid access_token`
- 400: `invalid code`, `code expired`, `PKCE verification failed`, `redirect_uri mismatch`, `refresh_token reuse detected` 등

메시지 부분 문자열로 판단 가능 (`invalid`, `expired`, `mismatch`, `reuse`).

## 7. 아직 없는 것 (주의)

- `/.well-known/openid-configuration` 없음 → 수동 설정.
- JWKS 엔드포인트 없음 → JWT 로컬 검증은 HS256 공유키 방식.
- Discovery, ID Token(OIDC), PAR, 동적 클라이언트 등록 미지원.
