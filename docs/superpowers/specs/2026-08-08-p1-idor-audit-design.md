# P1 IDOR 전수조사 설계 (2026-08)

> 상위 문서: `docs/api-authz-audit-2026-08.md` §2 P1. 그 문서가 **상황판(허브)** 이고 이 문서는 P1 한 계열의 실행 설계다.
> 수치의 출처는 전부 `node scripts/security/route-authz-audit.js` 다.

## 1. 문제

감사 스크립트가 "인가 표시 없음 = IDOR 검사 대상"으로 분류한 라우트가 **95건(그중 쓰기 37건)** 이다.
이들은 인증만 통과하면 핸들러에 도달하므로, 서비스 계층이 호출자 본인의 데이터로 범위를 좁혀야만
안전하다. `where(userId = ...)` 하나만 빠져도 남의 데이터가 열린다.

**그런데 표본 2건이 연속으로 위양성이었다.**

| 라우트 | 감사 분류 | 실제 |
|---|---|---|
| `DELETE /files/:fileId` | 인가 표시 없음 | `file-access.ts:55` — `file.uploadedBy === user.userId` |
| `PATCH /reviews/:id` | 인가 표시 없음 | `reviews.service.ts:524` — `eq(reviews.userId, userId)` |

감사 스크립트는 **라우트 데코레이터**만 본다. IDOR 방어는 **서비스 계층**에 산다. 두 층이 다르므로
스크립트의 95건은 "취약한 라우트"가 아니라 "**스크립트가 판정할 수 없는 라우트**"다.

따라서 이 작업의 산출물은 수정 패치가 아니라 **판정과 그 근거**이며, 진짜 위험은 작업량이 아니라
**위음성**이다. 에이전트가 membership 26건을 훑고 "다 안전합니다" 했는데 그중 하나가 진짜 구멍이면,
조사를 안 한 것보다 나쁘다 — 안전하다는 문서가 남기 때문이다.

## 2. 범위

### 대상 95건

```bash
node scripts/security/route-authz-audit.js --json > /tmp/audit.json
node -e "
const all=require('/tmp/audit.json');
const DEFAULT_DENY=new Set(['core','notification','channel-adapter','wallet']);
const b=all.filter(r=>DEFAULT_DENY.has(r.app) ? r.storeRoute : (!r.isPublic&&!r.storeRoute&&!r.authz));
console.log(b.length);  // 95
"
```

| 앱 | 대상 | 쓰기 | 비고 |
|---|---|---|---|
| membership | 26 | 7 | `/subscriptions/*`, `/savings/*`, `/pause/*` — 금전 영향 |
| core (`@StoreRoute`) | 22 | 8 | 2건은 확인 완료(§3-1), 나머지 미확인 |
| user-service | 20 | 10 | 대부분 `me` 계열, `:id` 받는 것 주의 |
| ugc-service | 12 | 7 | 리뷰·QnA 수정/삭제 |
| file-service | 5 | 3 | `FileAccess` 가 중앙집중 검사 |
| search | 4 | 0 | 전역 가드 없음 — IDOR 이전에 인증이 없다 |
| analytics | 4 | 0 | 동일 |
| notification | 2 | 2 | `@StoreRoute` |
| **합계** | **95** | **37** | |

### 비목표 (YAGNI)

- IDOR 축 밖의 문제를 이번에 **고치지 않는다**. 수집만 한다 (§4 관찰 목록).
- mass assignment, SSRF, `@Public` 75건 개별 검토는 별건이다 (감사 문서 §3-5).
- core 의 비-`@StoreRoute` 454건은 대상이 아니다. `AdminRealmGuard` 가 직원으로 좁히고,
  직원 간 스코프 분리는 별개 계열이다 (`#546` 창고 쓰기 스코프).

## 3. 결정사항

### 3-1. 검증 강도 — 증거 강제 + 쓰기만 반증

모든 판정에 `file:line` 과 **술어 원문**을 강제한다. `SAFE` 판정은 추가로, 쓰기 라우트에 한해
별도 에이전트가 반증을 시도한다.

**근거**: 읽기의 위음성은 정보 노출이고 쓰기의 위음성은 데이터 변조다. 무게가 다르므로 비용도
다르게 쓴다. 전건 반증은 읽기 58건에 같은 비용을 쓰는데 그만한 값을 하지 않는다.

### 3-2. 회귀 방어 — 명단 스냅샷 테스트

P0 의 `route-authz-audit.spec.ts` 패턴을 재사용해 판정 명단을 테스트로 고정한다 (§6).

**근거**: 감사 문서 §1-2 의 결론 그대로다 — "개별 라우트가 아니라 **규칙**으로 걸어야 다음 사고를
잡는다." 문서만 남기면 코드와 어긋나고, 다음 사람은 문서를 믿다가 틀린다.

### 3-3. 조사 범위 — IDOR 한 축, 나머지는 수집만

판정은 IDOR 한 축으로만 내린다. 조사 중 마주치는 다른 문제는 **관찰 목록**에 모아 감사 문서의
P2/P3 로 분류해 올린다.

**근거**: 범위는 지키되 정보는 안 버린다. 발견할 때마다 고치면 PR 범위가 예측 불가능해지고,
버리면 같은 코드를 다음에 또 읽어야 한다.

## 4. 판정 스키마

| 판정 | 의미 | 요구 증거 |
|---|---|---|
| `SAFE` | 호출자 식별자가 조회/변경 **술어에 실제로 들어감** | `file:line` + **술어 원문 한 줄 그대로** |
| `VULN` | 식별자가 술어에 없음 | 술어가 없는 `file:line` + 재현 경로 |
| `N/A` | IDOR 이 성립 안 함 (생성 라우트 — 대상 객체가 없음, 헬스체크) | 사유 |
| `UNCLEAR` | 추적이 막힘 (동적 디스패치, 외부 서비스 위임) | **막힌 지점** |

**`SAFE` 의 증거 요구가 이 설계의 핵심이다.** 술어를 원문 그대로 인용하게 하면 그 문자열이 그
파일 그 줄에 실재하는지 `grep -F` 로 기계 검증할 수 있다. 환각 인용이 여기서 죽는다.
"확인했고 안전합니다" 같은 서술은 증거로 인정하지 않는다 — 검증할 수가 없다.

**`UNCLEAR` 는 실패가 아니라 정상 출력이다.** 이걸 실패로 취급하면 에이전트가 확신 없는 `SAFE` 로
도망친다. 정확히 우리가 막으려는 위음성이다. `UNCLEAR` 는 오케스트레이터가 직접 본다.

### 산출물 2개

1. **판정표** — 95건 × (판정 + 증거). 스냅샷 테스트의 입력이 된다.
2. **관찰 목록** — IDOR 축 밖 발견. 예: `file-access.ts:58` — `scopes: ['master']` 서비스 위임
   토큰은 소유권 검사를 전량 통과한다. IDOR 은 아니지만 토큰이 새면 전부 열린다.

## 5. 에이전트 구성

### 5-1. 조사 에이전트 6개 (병렬, 읽기 전용)

앱 단위로 쪼갠다. IDOR 판정은 컨트롤러→서비스→리포지토리 체인 추적이고, 같은 앱의 라우트는
**같은 서비스 파일을 공유**한다. 앱 단위로 묶으면 그 파일을 한 번 읽고 n 건을 판정한다.
라우트 균등 분할은 같은 파일을 여러 에이전트가 중복해서 읽게 만들고, 더 나쁘게는 에이전트마다
다르게 이해할 수 있다.

| # | 담당 | 라우트 |
|---|---|---|
| 1 | membership | 26 |
| 2 | core `@StoreRoute` | 22 |
| 3 | user-service | 20 |
| 4 | ugc-service | 12 |
| 5 | file-service + notification | 7 |
| 6 | search + analytics | 8 |

6번은 사실상 P3 의도확인이다. 두 앱 모두 전역 가드가 없어 IDOR 이전에 인증 자체가 없다. 판정은
금방 끝나고, 쓸모는 "의도인지"를 근거와 함께 문서화하는 데 있다.

**입력**: 담당 라우트 목록(`verb`, `route`, `file:line`, `handler`), 앱의 인가 관용구(감사 문서
§3-1 표), 그리고 **이미 확인된 SAFE 사례 2건**(§1 표) — 증거가 어떤 모양이어야 하는지 보여주는
본보기.

**출력**: `<scratchpad>/idor/<app>.json`. 반환 텍스트가 아니라 파일로 받는다. 95건 판정을 대화로
흘리면 오케스트레이터의 컨텍스트가 증거 검증에 쓸 자리를 잃는다.

**금지**: 레포 안의 어떤 파일도 수정 금지. 쓰기는 scratchpad 한정. 수정 제안이 떠오르면 판정에
적기만 하고 손대지 않는다. (서브에이전트 워크트리 오염이 이 레포에서 5회 재발했고, 그중엔
`origin/develop..develop` 탐지를 통과하는 미커밋 편집 변종이 있다.)

**방법 지시**: 컨트롤러의 파라미터 수신은 증거가 **아니다**. `@User('userId') userId` 를 받아놓고
서비스에서 안 쓰는 것이 이 감사가 찾는 함정이다 — 컨트롤러만 보면 안전해 보인다. 리포지토리의
`where` 절까지 따라가야 판정이다.

### 5-2. 반증 에이전트 3개

대상은 **쓰기 37건 중 `SAFE` 로 판정된 것만**. `VULN` 은 어차피 고치므로 반증할 이유가 없다.

기본값은 **반증**이다. "안전해 보인다"로 끝나면 통과가 아니라, 뒤집을 근거를 못 찾았을 때만
`SAFE` 가 유지된다. 그리고 `SAFE` 가 틀리는 방식 네 가지를 명시적으로 쥐어 준다 — 그냥 "깨보라"고
하면 에이전트는 원 판정을 재확인하고 동의해 버린다.

1. **식별자의 출처가 토큰이 아니라 요청 바디** — 술어는 멀쩡한데 `userId` 가 클라이언트가 보낸 값.
   술어만 보면 안전해 보인다. **P0 에서 터진 게 정확히 이 모양이다** (바디의 `userId` 로 리뷰 자격 발급).
2. **조건부 술어** — `if` 안에 있어 특정 분기에서 건너뛴다.
3. **같은 라우트의 다른 도달 경로** — 오버로드·분기·배치 처리기가 술어를 우회한다.
4. **트랜잭션/캐시 경로 우회**.

### 5-3. 오케스트레이터의 기계 검증

에이전트 결과를 액면 그대로 받지 않는다. 모든 `SAFE` 판정에 대해 인용된 술어 원문이 해당
`file:line` 에 실재하는지 `grep -F` 로 확인한다. 불일치는 `UNCLEAR` 로 강등하고 직접 읽는다.

## 6. 스냅샷 회귀 테스트

`scripts/security/idor-reviewed.spec.ts` — P0 의 `route-authz-audit.spec.ts` 와 같은 자리에 두어
`npx jest scripts/security` 로 함께 돈다.

```ts
// 키는 반드시 `<app> <VERB> <route>` 다. `<VERB> <route>` 만 쓰면 안 된다 —
// search 와 analytics 가 둘 다 `GET /health` 라서 95건이 94개로 뭉개진다.
const IDOR_REVIEWED = {
  'ugc-service PATCH /reviews/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:524',
    predicate: 'eq(reviews.userId, userId)',
  },
  'file-service DELETE /files/:fileId': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:55',
    predicate: 'file.uploadedBy === user.userId',
  },
  // ...95건
};
```

테스트는 감사 스크립트의 [B] 집합과 맵의 키 집합을 **양방향** 비교한다. 새 라우트가 생기면
빨개지고, 라우트가 사라지면 맵 정리를 강제한다. 키 개수가 95 인지도 함께 못 박아 키 충돌로 인한
조용한 유실을 막는다.

맵은 **손으로 쓴다**. 생성하면 요점이 사라진다 — 사람이 쓴 문장이 증거라는 게 이 장치의 전부다.

### 한계 (반드시 알고 쓸 것)

**기존 술어를 지우는 건 못 잡는다.** IDOR 은 의미론이라 AST 로 판정할 수 없다. 이 장치가 막는 건
"새 구멍"이지 "기존 방어의 퇴행"이 아니다. 그걸 모르고 초록불을 믿으면 P0 이전보다 위험하다.

## 7. 실행 순서

| 단계 | 내용 | 마이그 |
|---|---|---|
| PR-0 | Neon fallback 제거 (독립·선행 가능) | 0 |
| — | 조사 6 + 반증 3 (코드 변경 없음) | — |
| PR-1 | 스냅샷 테스트 + 감사 문서 P1 섹션 갱신 | 0 |
| PR-2..n | `VULN` 수정, 앱 단위 | 0 예상 |

`VULN` 이 0건이면 PR-1 에서 끝난다. 표본 2건이 다 안전했으므로 가능성 있는 결말이고, 그건 실패가
아니라 **근거를 남긴 종결**이다.

**`VULN` 수정 PR 의 함정**: 남의 데이터가 보이던 게 403 이 되는 것은 **동작 변경**이다. 프론트가
그 동작에 의존 중이면 깨진다 (감사 문서 P3 의 죽은 경로 4건이 같은 종류의 부채다). 수정 PR 은
호출자 확인이 선행 조건이다.

## 8. Neon fallback 제거 (PR-0)

`apps/channel-adapter/src/adapter.module.ts:112` 의 `DbModule.forRoot` fallback 에 Neon 접속
문자열이 **비밀번호까지 하드코딩**되어 있다.

**동작 위험 없음 — 증명**: `apps/channel-adapter/src/config/env.validation.ts:5` 가
`DATABASE_URL: z.string().url()` 로 이미 필수이고, SST 가 `deployments/lcnine/services/infra/services.ts:212`
에서 `dbUrl('channel_adapter')` 로 주입한다. env 가 없으면 fallback 을 쓰기 전에 검증이 부팅을
죽인다. 즉 이 fallback 은 **이미 도달 불가능한 죽은 코드**다.

### 사람 작업 (코드로 못 끝낸다)

코드에서 지워도 크레덴셜은 회수되지 않는다. 공개 레포 히스토리 재작성 이후에도 `refs/pull` 364개와
포크 3개가 원본을 붙들고 있다 (`docs/git-history-rewrite-2026-08-07.md`).

- [ ] Neon 콘솔에서 해당 프로젝트/DB **삭제** (미사용 확인됨) — 이것이 진짜 종결이다
- [ ] 삭제 대신 유지한다면 비밀번호 **로테이션**

## 9. 검증 기준선

변경 후 이 수치보다 늘면 내 탓이다 (감사 문서 §3-3 과 동일 기준).

- `node scripts/security/route-authz-audit.js` → **`[A] 무력화 0`**. 0 이 아니면 exit 1.
- `npx jest scripts/security` → 전부 통과. 새 `@Public` 쓰기 라우트나 미등재 IDOR 라우트가
  생기면 여기서 빨개진다.
- `npx eslint <변경파일>` → **변경 파일의 신규 error 0**. 이 레포는 전역 lint 가 상시 debt 라
  (SST `services.ts` 만 ~399건) 총량은 의미가 없다. 감사 문서 §3-3 의 "14건"은 P0 당시 *그* 변경
  파일들의 수치이므로 다른 파일에 그대로 옮기지 말 것.
- core 타입 검사는 `npm run lint` / `nest build core` 가 아니라 **임시 tsconfig 를 repo 루트에**
  만들어 변경 파일을 include 해서 본다. `type-check:scoped` 의 include 는 5개뿐이라 변경 파일이
  안 들어가면 통과해도 의미가 없다.
