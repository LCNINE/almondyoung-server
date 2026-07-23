# warehouse-app ↔ 로컬 core 연결 복구 (Tauri HTTP scope) 설계 스펙

- 날짜: 2026-07-23
- 대상: `native/warehouse-app/src-tauri/capabilities`, `docs/local-dev.md`
- 브랜치: `fix/warehouse-app-local-core-http-scope`
- 상태: 설계 승인됨 (구현 전)
- 관련 문서:
  - `docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md` — 로컬 core + `dev_core` 시드 설계. 본 문서는 그 **§8 의 누락분을 메운다.**
  - `docs/local-dev.md` — 로컬 개발 환경의 SoT.

## 1. 배경

`dev_core` 시드 작업(위 스펙, develop 에 squash `650436d4e` 로 머지됨)이 §8 에서 warehouse-app 을
로컬 core 로 전환했다. 실제로 반영된 것은 둘이다.

- `native/warehouse-app/.env.local.example` 의 `VITE_API_BASE_URL` 기본값 → `http://localhost:3100`
- `native/warehouse-app/package.json` 에 `tauri:dev` / `tauri:dev:live` (`cross-env`)

**그런데 이 상태로는 앱이 로컬 core 에 단 한 건도 붙지 못한다.** §8 이 Tauri 의 HTTP scope 를
빠뜨렸고, §9 스모크(4번: 앱 로그인 → 재고조회 표에 시드 SKU 20건)를 아직 돌리지 않아 드러나지 않았다.

## 2. 원인

`native/warehouse-app/src-tauri/capabilities/default.json` 의 `http:default` scope:

```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "https://user.almondyoung.com/*" },
    { "url": "https://core.almondyoung.com/*" }
  ]
}
```

`@tauri-apps/plugin-http` 는 **deny-by-default** 다. `http:default` 권한 자체의 설명이 "fetch 연산을
활성화하지만 어떤 origin 도 명시적으로 허용하지 않으며, 사용 전에 수동 설정이 필요하다"고 못박는다.
scope 에 없는 URL 은 Rust 쪽에서 거부되므로 **요청이 앱 밖으로 나가지 않는다.**

`src/core/data/httpClient.ts` 가 `@tauri-apps/plugin-http` 의 `fetch` 를 쓰므로,
`src/domains/inventory/useSkuSearch.ts` 의 `GET /inventory/skus/search/advanced` 를 포함한
모든 API 호출이 `http://localhost:3100` 대상일 때 전량 실패한다.

증상이 고약한 이유: 에러 문구(`url not allowed on the configured scope`)가 콘솔에만 뜨고 화면에는
일반 에러로 보이며, env·시드·DB·토큰 어느 쪽도 원인이 아니라 **원인 후보에서 가장 늦게 의심되는
자리**에 있다.

## 3. 변경

### 3.1 capability scope (핵심, 1파일)

`capabilities/default.json` 의 `http:default` → `allow` 에 두 줄 추가:

```json
{ "url": "http://localhost:3100/*" },
{ "url": "http://127.0.0.1:3100/*" }
```

- **`127.0.0.1` 을 함께 넣는 이유**: scope 매칭은 호스트 문자열 기준이라 `localhost` 항목이
  `127.0.0.1` 을 커버하지 않는다. 로컬 core 를 IP 로 직접 지목하는 상황이 흔하다.
- **dev 전용 capability 로 분리하지 않는다.** 검토했으나 기각 — scope 는 "부를 수 있음"만 넓히고
  실제 대상은 빌드타임 `VITE_API_BASE_URL` 이 정한다. 프로덕션 번들에 localhost 허용이 남아도
  앱이 localhost 를 부르는 코드 경로가 없다. `tauri.conf.json` 의 `app.security.capabilities` 목록 +
  `tauri dev --config` 병합 플럼빙 + 스크립트 분기 비용이 실익보다 크다.
- **호스트 와일드카드(`http://*:3100/*`)도 기각.** Android/타기기 전환을 선반영하는 값이지만
  `src-tauri/gen` 이 아직 없어 그 작업 자체가 존재하지 않는다 (§6).

> ⚠️ **capability 변경은 Rust 재빌드를 요구한다.** `build.rs` 가 컴파일 타임에 capability →
> 권한 코드를 생성하므로 Vite HMR 로는 반영되지 않는다. 변경 후 첫 `tauri dev` 는 재빌드가 돈다.

### 3.2 회귀 방어 (1 테스트)

`native/warehouse-app/src/core/data/httpScope.test.ts` 를 추가한다. `node:fs` 로
`src-tauri/capabilities/default.json` 을 읽어 `http:default` 의 `allow` 가 다음 넷을 모두
담고 있는지 확인한다 — 라이브 2개(`user`/`core`)와 로컬 2개(`localhost:3100`/`127.0.0.1:3100`).

`src/core/data/` 에 두는 이유: 이 scope 가 지키는 대상이 같은 디렉터리의 `httpClient.ts` 다.
vitest 는 jsdom 환경이지만 Node 위에서 돌아 `node:fs` 를 그대로 쓸 수 있다.

근거: 누군가 scope 를 정리하다 지우면 증상이 "로컬 개발이 통째로 안 됨"인데 에러 문구가 원인을
가리키지 않아 이번과 똑같이 헤매게 된다. 비용은 10줄 남짓이고, 검증 대상이 순수 JSON 이라
테스트가 깨질 이유도 거의 없다.

### 3.3 문서 (2곳)

- **`docs/local-dev.md`** — "warehouse-app 은 기본이 로컬 core 다" 항목에, **core 포트를 바꾸면
  `capabilities/default.json` 도 같이 고쳐야 한다**는 사실을 붙인다. env 만 고치면 조용히 안 되는
  것이 이 배선의 함정이고, 이 문서가 로컬 환경의 SoT 라 여기 없으면 다음 사람이 못 찾는다.
- **`2026-07-23-local-core-dev-environment-design.md` §8** — capability scope 누락을 사후 정정으로
  추가한다. 해당 스펙은 이미 "구현 후 확정된 축소 3건" 같은 사후 주석을 담고 있어 관행에 맞는다.

## 4. 비목표

- **Android / 타 기기 접속** — `src-tauri/gen` 이 없어 Android 프로젝트가 미초기화다. LAN/Tailscale
  IP scope 추가와 cleartext HTTP 허용은 그 작업에 딸린 별건이다.
- **Diagnostics 에 현재 API 대상 표시** — 로컬/라이브 오조준 방지 가치는 있으나 이번 범위 밖.
- **`.env.local` 의 `VITE_HTTP_DEBUG`** — 읽는 코드가 없는 죽은 값이다(주석은 "끝나면 제거"라고
  적혀 있다). 본 변경과 무관하므로 손대지 않는다.

## 5. 검증 (스모크) — 분담

### 5.1 백엔드 (에이전트)

1. `docker compose up -d` → `docker compose ps` 에 postgres · kafka · zookeeper 가 모두 running.
2. `npm run dev:core:reset` 이 가드 → 마이그레이션 → 시드까지 에러 없이 완료.
3. `npm run start:main:dev` 로 core 부팅, 로그에 `Scope initialization complete`.
4. HS256 토큰으로 `GET /inventory/skus/search/advanced?search=DEV-SKU&limit=20&offset=0`
   → `total` 20, `items` 20건.
   - `npm run generate:token` 은 readline 대화형이라 비대화식 셸에서 못 쓴다. 같은 페이로드
     (`sub`/`userId`/`email`/`roles`, `iss: 'almondyoung-auth'`, HS256 + `AUTH_SECRET`)를 인라인으로
     서명해 쓴다.
5. core 는 **띄워둔 채로** 사용자에게 넘긴다 (이어서 앱을 붙일 것이므로).

여기까지 통과하면 core · DB · 시드 · 엔드포인트가 정상임이 확정돼, 앱에서 실패할 경우 원인이
앱 쪽으로 좁혀진다.

### 5.2 앱 (사용자)

`cd native/warehouse-app && npm run tauri:dev` → 로그인 → 재고조회에서 `DEV-SKU` 검색 → 20건.
(capability 변경 후 첫 실행은 Rust 재빌드가 돈다.)

실패 시 분기:

| 증상 | 원인 |
|---|---|
| 콘솔에 `url not allowed on the configured scope` | scope 미반영 (재빌드 안 됨 / 포트 불일치) |
| 401 | 토큰 — 라이브 OIDC 로그인 또는 core 의 `OIDC_ISSUER_URL` |
| 표가 빔 (에러 없음) | DB — `dev_core` 가 아닌 DB 를 보고 있거나 시드 미적용 |

## 6. 구현 체크리스트

- [ ] `capabilities/default.json` 에 `http://localhost:3100/*` · `http://127.0.0.1:3100/*` 추가 — §3.1
- [ ] capability scope 회귀 테스트 (vitest) — §3.2
- [ ] `docs/local-dev.md` 에 포트 변경 시 capability 동반 수정 명시 — §3.3
- [ ] `2026-07-23-local-core-dev-environment-design.md` §8 사후 정정 — §3.3
- [ ] §5.1 백엔드 스모크 4단계 수행, core 기동 상태로 인계
- [ ] §5.2 앱 스모크 (사용자)
