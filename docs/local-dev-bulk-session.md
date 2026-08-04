# 상품 일괄 등록/수정 — 로컬 테스트 환경

라이브를 건드리지 않고 admin-web → core → file-service 전 구간을 로컬에서 돌린다.
스모크 항목은 `docs/superpowers/specs/2026-08-04-product-bulk-session-smoke-checklist.md`.

일반 로컬 개발 절차는 `docs/local-dev.md` 를 먼저 본다. 이 문서는 이 기능이 **추가로**
요구하는 것만 적는다.

## 구성

| 앱 | 포트 | DB |
|---|---|---|
| file-service | 3010 | `file_service` |
| core | 3100 | `dev_core` |
| admin-web | 8002 | — |

user-service·auth-web 는 **띄우지 않는다.** 인증은 아래 HS256 우회로를 쓴다.

## 셋업

### 1. `.env` 세 개

`apps/file-service/.env` — **`AUTH_SECRET` 은 core 와 같은 값이어야 한다.** core 가 자기
시크릿으로 서명한 위임 토큰을 file-service 가 검증한다(`form-export-file.client.ts`).

```dotenv
PORT=3010
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/file_service
AUTH_SECRET=<core 와 동일>
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID_PREFIX=file-service-local
KAFKA_GROUP_ID=file-service-local
STORAGE_PROVIDER=LOCAL
```

`apps/core/.env` — 한 줄 추가. `env-templates/.env.core.local.example` 은 이 키를 일부러
비워 두지만, 그 상태면 양식 생성이 첫 줄에서 죽는다.

```dotenv
FILE_SERVICE_URL=http://localhost:3010
```

`apps/admin-web/.env.local`

```dotenv
ALMONDYOUNG_API_URL=http://localhost:3100
FILE_SERVICE_URL=http://localhost:3010
BYPASS_AUTH=true
```

### 2. 인프라 · 스키마 · 시드

```bash
docker compose up -d
npm run db:migrate:local                                   # file_service 포함
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dev_core \
  npx drizzle-kit migrate --config apps/core/drizzle.config.ts   # dev_core 는 별도
npm run dev:seed-file-contexts                             # ★ 없으면 업로드가 전부 404
```

`dev:seed-file-contexts` 가 필요한 이유: file-service 는 `file_contexts` 행이 없으면
업로드를 `Context <id> not found` 로 거절하는데, 그 행을 넣는 정식 시드는 `sst shell` 에
묶여 있어 로컬에 못 쓴다.

`dev_core` 를 통째로 리셋하고 싶으면 `npm run dev:core:reset` 이지만, 이 기능만 볼 거면
마이그레이션만 얹으면 된다 — 시드(inventory SKU)는 이 기능과 무관하다.

### 2-1. 카테고리 (선택이지만 없으면 헷갈린다)

`dev_core` 시드는 inventory SKU 만 만들고 **카탈로그 카테고리는 만들지 않는다.**
카테고리가 없으면 빈 양식의 「카테고리 참조」 시트가 헤더만 있는 채로 내려온다 — 버그가
아니라 데이터가 없는 것이다. 카테고리 축(경로 해석 · 대표여부 · 없는 경로 행 오류)을
테스트하려면 몇 개 만들어 둔다:

```bash
TOKEN=<HS256 토큰>            # 아래 3절에서 발급
curl -sX POST http://localhost:3100/categories \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"패션의류"}'
# 반환된 id 를 parentId 로 넘겨 하위를 만든다 (경로는 ">" 로 이어진다)
```

⚠️ 테이블 이름은 `categories` 가 아니라 **`product_categories`** 다. 엉뚱한 쪽을 세면
카테고리가 실제로 있는데도 0행으로 보인다.

`npm run dev:core:reset` 을 돌리면 이 카테고리도 함께 사라진다.

### 3. 인증 — HS256 우회로

core 도 file-service 도 dual-mode 라(`jwt-access.strategy.ts`) `AUTH_SECRET` 으로 서명한
HS256 토큰을 그대로 받는다. admin-web 은 `BYPASS_AUTH=true` 가 페이지 가드를 열고,
프록시(`api/proxy/_lib/forward.ts`)가 `accessToken` 쿠키를 업스트림에 그대로 넘긴다.

```bash
node -e '
const fs=require("fs"), jwt=require("jsonwebtoken");
const secret=fs.readFileSync("apps/core/.env","utf8").split("\n")
  .find(l=>l.startsWith("AUTH_SECRET=")).slice(12).trim();
const userId="11111111-2222-3333-4444-555555555555";
console.log(jwt.sign({sub:userId,userId,email:"local-md@almondyoung.test",roles:["master","admin"]},
  secret,{algorithm:"HS256",expiresIn:"365d"}));
'
```

⚠️ **`iss` 클레임을 넣지 마라.** `scripts/generate-jwt-token.js` 는 `iss:'almondyoung-auth'`
를 넣는데, `jwt-access.strategy.ts` 가 `iss` 가 있으면 `OIDC_ISSUER_URL`(라이브 user-service)
과 대조해 **401** 을 낸다. `iss` 가 없으면 그 검사 자체를 건너뛴다.

브라우저에서 `http://localhost:8002` 를 연 뒤 콘솔에:

```js
document.cookie = 'accessToken=<위 토큰>; path=/';
location.reload();
```

### 4. 기동

```bash
npm run start:file-service:dev   # :3010
npm run start:main:dev           # :3100
npm run start:admin-web:dev      # :8002
```

`http://localhost:8002/mall/bulk-sessions`

## 로컬로는 검증되지 않는 것

- **MD 계정 `roles` 실측** — 이 구성이 바로 그 관문을 우회하므로 구조적으로 못 잡는다.
  체크리스트 0번은 라이브에서만 확인 가능하다
- **ALB 60초 천장** — 로컬엔 ALB 가 없어 동기 경로의 타임아웃 위험이 안 드러난다
- **실제 S3** — `STORAGE_PROVIDER=LOCAL` 은 로컬 디스크(`<cwd>/uploads`)를 쓰고 서명 URL
  대신 `GET /files/local/*` 를 돌려준다. 대용량 전송 특성은 다르다

## 알아둘 것

- **비ASCII 원본 파일명이 file-service 업로드에서 깨진다** (기존 결함, 이 기능과 무관).
  multer/busboy 가 파일명 파라미터를 latin-1 로 읽어 `상품일괄양식_….xlsx` 가
  `ìƒ…xlsx` 로 저장된다. 프리필 양식을 받으면 파일명이 깨져 보이지만 **내용은 정상**이다
- `uploads/` 는 gitignore 돼 있다. 비우려면 그냥 지우면 된다(DB 행은 남으니 되읽기는 404)
