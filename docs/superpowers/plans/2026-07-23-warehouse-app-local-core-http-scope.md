# warehouse-app ↔ 로컬 core 연결 복구 (Tauri HTTP scope) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `native/warehouse-app` 이 로컬 core(`http://localhost:3100`)에 실제로 붙도록 Tauri 의 HTTP scope 를 열고, 회귀 방어 테스트와 문서를 함께 넣은 뒤 스모크로 확인한다.

**Architecture:** 변경의 본체는 JSON 설정 한 파일(`src-tauri/capabilities/default.json`)이다. `@tauri-apps/plugin-http` 는 deny-by-default 라 scope 에 없는 URL 은 Rust 쪽에서 거부되어 요청이 앱 밖으로 나가지 않는다. 이 설정을 코드가 아닌 곳에 두면 조용히 삭제될 수 있으므로 JSON 을 직접 읽는 vitest 로 고정한다. 마지막으로 백엔드(core·DB·시드·엔드포인트)를 먼저 스모크해 원인 범위를 앱 쪽으로 좁힌 상태에서 사용자에게 인계한다.

**Tech Stack:** Tauri v2 (capabilities / `build.rs` 컴파일 타임 권한 생성), `@tauri-apps/plugin-http`, vitest (jsdom, `globals: true`), NestJS core (`:3100`), drizzle + postgres(`dev_core`), docker compose.

## Global Constraints

- 로컬 core 포트는 **3100** 이다 (`docs/local-dev.md` 포트맵, `apps/core/.env` 의 `PORT`). scope · 문서 · 스모크에서 이 값을 그대로 쓴다.
- scope 에 넣는 URL 은 정확히 두 개다: `http://localhost:3100/*` · `http://127.0.0.1:3100/*`. 호스트 와일드카드(`http://*:3100/*`)와 dev 전용 capability 분리는 설계에서 **기각**됐다 (스펙 §3.1).
- 라이브 두 항목(`https://user.almondyoung.com/*` · `https://core.almondyoung.com/*`)은 **제거하지 않는다** — `tauri:dev:live` 와 OIDC 토큰 교환이 이걸 쓴다.
- capability 변경은 `build.rs` 가 컴파일 타임에 읽으므로 Vite HMR 로 반영되지 않는다. 앱 확인은 `tauri dev` 재빌드가 전제다.
- 본 계획은 `native/warehouse-app/src` 의 런타임 코드를 **수정하지 않는다**. `httpClient.ts` · `useSkuSearch.ts` 는 이미 올바르고, 막힌 것은 scope 하나다.
- 비목표(스펙 §4): Android/타기기 scope·cleartext, Diagnostics 의 API 대상 표시, `.env.local` 의 죽은 `VITE_HTTP_DEBUG` 정리. 건드리지 않는다.

---

### Task 1: capability scope 개방 + 회귀 방어 테스트

**Files:**
- Create: `native/warehouse-app/src/core/data/httpScope.test.ts`
- Modify: `native/warehouse-app/src-tauri/capabilities/default.json:11-17`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `src-tauri/capabilities/default.json` 의 `http:default` → `allow` 가 라이브 2개 + 로컬 2개, 총 4개 URL 을 담는다. Task 2 의 문서가 이 사실을 서술하고, Task 3 의 스모크가 이걸 전제한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`native/warehouse-app/src/core/data/httpScope.test.ts` 신규:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// src-tauri/capabilities/default.json 은 빌드 산출물이 아니라 소스다. build.rs 가 컴파일
// 타임에 읽어 권한 코드를 생성하고, 여기 없는 URL 은 plugin-http 가 런타임에 거부한다
// (deny-by-default) — 요청이 앱 밖으로 나가지도 않는다. 같은 디렉터리의 httpClient.ts 가
// 그 plugin-http 를 쓰므로, 이 목록이 곧 httpClient 가 도달 가능한 범위다.
const capabilityPath = fileURLToPath(
  new URL('../../../src-tauri/capabilities/default.json', import.meta.url)
);

interface HttpPermission {
  identifier: string;
  allow: { url: string }[];
}

function httpAllowList(): string[] {
  const capability = JSON.parse(readFileSync(capabilityPath, 'utf8')) as {
    permissions: (string | HttpPermission)[];
  };
  const http = capability.permissions.find(
    (p): p is HttpPermission =>
      typeof p === 'object' && p.identifier === 'http:default'
  );
  if (!http) throw new Error('http:default permission not found in default.json');
  return http.allow.map((entry) => entry.url);
}

describe('tauri http scope', () => {
  it('로컬 core 를 허용한다 — 빠지면 로컬 개발의 모든 API 호출이 차단된다', () => {
    const urls = httpAllowList();
    expect(urls).toContain('http://localhost:3100/*');
    // scope 매칭은 호스트 문자열 기준이라 localhost 항목이 127.0.0.1 을 커버하지 않는다.
    expect(urls).toContain('http://127.0.0.1:3100/*');
  });

  it('라이브 호스트를 유지한다 — tauri:dev:live 와 OIDC 토큰 교환이 쓴다', () => {
    const urls = httpAllowList();
    expect(urls).toContain('https://user.almondyoung.com/*');
    expect(urls).toContain('https://core.almondyoung.com/*');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
cd native/warehouse-app && npm test -- src/core/data/httpScope.test.ts
```

Expected: 첫 번째 `it` 만 FAIL —
`AssertionError: expected [ 'https://user.almondyoung.com/*', 'https://core.almondyoung.com/*' ] to include 'http://localhost:3100/*'`.
두 번째 `it`(라이브 호스트 유지)은 이미 PASS 한다. 1 failed / 1 passed 가 정상이다.

- [ ] **Step 3: scope 를 연다**

`native/warehouse-app/src-tauri/capabilities/default.json` 의 `http:default` 블록을 아래로 교체한다 (기존 두 줄은 그대로 두고 두 줄만 추가):

```json
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://user.almondyoung.com/*" },
        { "url": "https://core.almondyoung.com/*" },
        { "url": "http://localhost:3100/*" },
        { "url": "http://127.0.0.1:3100/*" }
      ]
    }
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
cd native/warehouse-app && npm test -- src/core/data/httpScope.test.ts
```

Expected: PASS (2 passed).

- [ ] **Step 5: 앱 테스트 전체가 여전히 통과하는지 확인한다**

```bash
cd native/warehouse-app && npm test
```

Expected: `Test Files 30 passed (30)` / `Tests 79 passed (79)`. 기준선은 이 계획 작성 시점에 실측한 29 파일 / 77 테스트이고, 새 파일이 파일 1개 · 테스트 2개를 더한다. 파일 수가 29 로 그대로면 새 테스트가 안 잡힌 것이니 경로를 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add native/warehouse-app/src-tauri/capabilities/default.json native/warehouse-app/src/core/data/httpScope.test.ts
git commit -m "fix(warehouse-app): HTTP scope 에 로컬 core 추가 + scope 회귀 테스트"
```

---

### Task 2: 문서 — 포트 변경 시 동반 수정, 원 스펙 사후 정정

**Files:**
- Modify: `docs/local-dev.md:150-151`
- Modify: `docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md:279` (§8 의 "안드로이드 주의" 문단 뒤)

**Interfaces:**
- Consumes: Task 1 이 만든 scope 4항목. 문서가 이 상태를 서술한다.
- Produces: 없음 (문서만)

- [ ] **Step 1: `docs/local-dev.md` 의 warehouse-app 항목을 보강한다**

150-151 행의

```markdown
- warehouse-app 은 기본이 로컬 core 다. 라이브로 붙으려면
  `cd native/warehouse-app && npm run tauri:dev:live`.
```

를 아래로 교체:

```markdown
- warehouse-app 은 기본이 로컬 core 다. 라이브로 붙으려면
  `cd native/warehouse-app && npm run tauri:dev:live`.
  **core 포트를 3100 에서 바꾸면 `native/warehouse-app/src-tauri/capabilities/default.json` 의
  `http:default` → `allow` 목록도 같이 고쳐야 한다.** Tauri 의 `plugin-http` 는 deny-by-default 라
  scope 에 없는 URL 은 요청이 앱 밖으로 나가기 전에 거부된다 — `.env` 만 고치면 화면엔 평범한
  에러만 뜨고 콘솔에서야 `url not allowed on the configured scope` 를 보게 된다. capability 는
  `build.rs` 가 컴파일 타임에 읽으므로 고친 뒤 `tauri dev` 재빌드가 필요하다(HMR 로는 반영 안 됨).
```

- [ ] **Step 2: 원 스펙 §8 에 사후 정정을 붙인다**

`docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md` 의 §8 마지막 문단
("**안드로이드 주의**: …" 로 시작하는 줄) **바로 뒤**에 빈 줄을 하나 두고 아래를 삽입한다:

```markdown
> **사후 정정 (2026-07-23)**: 위 세 항목만으로는 앱이 로컬 core 에 붙지 못한다. `src-tauri/capabilities/default.json` 의 `http:default` scope 에 `http://localhost:3100/*` · `http://127.0.0.1:3100/*` 를 추가해야 한다 — `@tauri-apps/plugin-http` 는 deny-by-default 라 scope 에 없는 URL 은 요청이 앱 밖으로 나가기 전에 거부된다. 이 절이 scope 를 통째로 빠뜨린 채 머지됐고, §9 스모크 4번(앱 로그인 → 재고조회 표)을 돌리지 않아 드러나지 않았다. 상세: `docs/superpowers/specs/2026-07-23-warehouse-app-local-core-http-scope-design.md`
```

- [ ] **Step 3: 렌더링과 링크를 확인한다**

```bash
cd /home/pauseb/workspace/almondyoung-server
sed -n '148,160p' docs/local-dev.md
grep -n "사후 정정 (2026-07-23)" docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md
ls docs/superpowers/specs/2026-07-23-warehouse-app-local-core-http-scope-design.md
```

Expected: 두 편집이 의도한 위치에 들어갔고, 정정 노트가 가리키는 스펙 파일이 실제로 존재한다.

- [ ] **Step 4: 커밋**

```bash
git add docs/local-dev.md docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md
git commit -m "docs: 로컬 core 포트 변경 시 Tauri capability 동반 수정 명시 + 원 스펙 §8 정정"
```

---

### Task 3: 백엔드 스모크 — core·DB·시드·엔드포인트 확인 후 인계

**Files:** 없음 (검증 전용, 커밋 없음)

**Interfaces:**
- Consumes: Task 1 의 scope. 단, 이 태스크 자체는 앱을 띄우지 않으므로 scope 와 독립적으로 돈다 — 목적은 **앱에서 실패할 때 원인 후보에서 백엔드를 지우는 것**이다.
- Produces: `:3100` 에서 도는 core 프로세스와 시드된 `dev_core`. 사용자가 이어서 `npm run tauri:dev` 를 붙인다.

- [ ] **Step 1: 인프라를 올린다**

```bash
cd /home/pauseb/workspace/almondyoung-server
docker compose up -d
docker compose ps
```

Expected: `postgres` · `zookeeper` · `kafka` 가 모두 `running`(또는 `Up`). **kafka 가 없으면 core 는 부팅하지 않는다** — `apps/core/src/main.ts` 가 조건 없이 `startAllMicroservices()` 를 부르고 실패 시 `process.exit(1)` 한다. `redis` 는 core 단독 기동에 불필요하나 같이 떠도 무방하다.

- [ ] **Step 2: `dev_core` 를 밀고 다시 시딩한다**

```bash
npm run dev:core:reset
```

Expected: guard 통과 → drop/create → 마이그레이션 → 스코프 부트스트랩 → 시드까지 에러 없이 완료. `SEED_DEV_CORE_URL` 을 설정하지 않으므로 기본값(`postgresql://postgres:postgres@localhost:5432/dev_core`)을 쓰고 확인 프롬프트는 뜨지 않는다. 프롬프트가 뜬다면 셸에 그 변수가 남아 있는 것이니 `unset SEED_DEV_CORE_URL` 후 다시 돌린다.

- [ ] **Step 3: 시드가 실제로 들어갔는지 DB 에서 직접 본다**

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d dev_core -tAc \
  "select count(*) from skus where code like 'DEV-SKU-%'"
```

Expected: `20`. (`--bulk` 없이 돌렸으므로 20 이다. 320 이 나오면 이전 `--bulk` 상태가 남은 것.)

- [ ] **Step 4: core 를 백그라운드로 띄운다**

```bash
npm run start:main:dev
```

백그라운드로 실행하고 로그를 지켜본다. Expected: 부팅 로그에 `Scope initialization complete` 가 뜨고, Kafka 가 `localhost:9092` 에 붙는다. 토픽 부트스트랩이 실패해도 크래시하지 않지만 재시도로 부팅이 ~10초 늦어질 수 있다.

- [ ] **Step 5: core 가 응답하는지 확인한다**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/inventory/skus/search/advanced
```

Expected: `401`. 200 이면 인증이 빠진 것이고, 연결 거부면 아직 부팅 중이다 — 몇 초 뒤 다시 시도한다.

- [ ] **Step 6: HS256 토큰을 만들어 실제 데이터를 확인한다**

`npm run generate:token` 은 readline 대화형이라 비대화식 셸에서 못 쓴다. 같은 페이로드를 인라인으로 서명한다:

```bash
cd /home/pauseb/workspace/almondyoung-server
TOKEN=$(node -e '
const jwt = require("jsonwebtoken");
const fs = require("fs");
const env = Object.fromEntries(
  fs.readFileSync("apps/core/.env", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const id = "019d0008-0001-7000-a000-000000000001";
console.log(jwt.sign(
  { sub: id, userId: id, email: "dev@lcnine.kr", roles: ["master"], iss: "almondyoung-auth" },
  env.AUTH_SECRET,
  { expiresIn: "2h" }
));
')
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3100/inventory/skus/search/advanced?search=DEV-SKU&limit=20&offset=0" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("total:",j.total,"items:",j.items.length,"first:",j.items[0]&&j.items[0].code)})'
```

Expected: `total: 20 items: 20 first: DEV-SKU-0001`.
- 401 이 계속 나오면 `apps/core/.env` 의 `AUTH_SECRET` 을 못 읽은 것이다.
- `total: 0` 이면 core 가 `dev_core` 가 아닌 DB 를 보고 있다 — `apps/core/.env` 의 `DATABASE_URL` 을 확인한다.
- `roles: ["master"]` 는 `ScopeGuard` 를 전면 우회한다. inventory 모듈은 원래 scope 게이트가 없지만, 이 스모크가 auth 문제로 막히지 않게 하려는 선택이다.

- [ ] **Step 7: core 를 띄워둔 채로 사용자에게 인계한다**

core 프로세스를 **내리지 않는다.** 사용자에게 다음을 전달한다:

```bash
cd native/warehouse-app && npm run tauri:dev
```

로그인 → 재고조회에서 `DEV-SKU` 검색 → 20건. capability 를 고쳤으므로 첫 실행은 Rust 재빌드가 돈다.

실패 시 분기:

| 증상 | 원인 |
|---|---|
| 콘솔에 `url not allowed on the configured scope` | scope 미반영 — 재빌드가 안 돌았거나 core 포트가 3100 이 아님 |
| 401 | 토큰 — 라이브 OIDC 로그인 실패 또는 core 의 `OIDC_ISSUER_URL` |
| 표가 빔 (에러 없음) | DB — Step 3/6 을 다시 확인 |

---

## 완료 조건

- Task 1·2 의 커밋 2건이 `fix/warehouse-app-local-core-http-scope` 에 올라가 있다.
- `cd native/warehouse-app && npm test` 전체 통과.
- Task 3 Step 6 이 `total: 20 items: 20 first: DEV-SKU-0001` 을 출력했다.
- core 가 `:3100` 에서 돌고 있는 상태로 사용자에게 앱 스모크가 넘어갔다.
