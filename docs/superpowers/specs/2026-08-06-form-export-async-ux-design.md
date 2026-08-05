# 양식 생성 비동기 UX 설계 스펙

- 날짜: 2026-08-06
- 대상: `apps/core` (catalog/bulk-session) + `apps/admin-web`
- 상태: **설계 확정, 구현 미착수**
- 관련:
  - `docs/superpowers/specs/2026-07-31-product-bulk-session-design.md` (모체 스펙 — 이 문서는 그 1단계 산출물의 UX 공백을 메운다)
  - `docs/adr/0005-drizzle-migration-and-autodeploy.md` (마이그레이션 순서 — 이 스펙은 **마이그레이션 0건**이라 해당 없음)

## 1. 목표

양식 생성은 **수 분이 걸릴 수 있는 비동기 작업인데, 화면은 사용자가 끝까지 지켜본다고 가정하고 만들어져 있다.** 그 간극에서 구멍 셋이 나왔다.

| # | 구멍 | 현재 결과 |
|---|---|---|
| 1 | 실패해도 상태가 `running` 이고 화면이 오류를 숨긴다 | 최대 ~90분 스피너 |
| 2 | 모달을 닫으면 `exportId` 가 유실되고 목록 API 가 없다 | 완성된 xlsx 가 30일간 고아 |
| 3 | 재요청에 중복 제거가 없다 | 모달을 여닫을 때마다 직렬 큐에 중복 잡 |

셋 다 "생성이 오래 걸린다"는 하나의 전제에서 파생되므로, 개별 패치가 아니라 **"사용자는 자리를 뜬다"를 전제로 한 흐름**으로 다시 잡는다.

**전제 (사용자 확정, 2026-08-06):** 실제 운용에서 양식 생성은 **수 분 단위**로 갈 수 있다고 가정한다.

## 2. 현재 상태 실측 (2026-08-06, `ff4659213`)

### 2.1 서버

| 사실 | 근거 |
|---|---|
| 목록 API 가 없다. 라우트는 `POST /`, `GET blank`, `GET :exportId`, `GET :exportId/download-url` 뿐 | `form-export.controller.ts` |
| 매니저 주석이 목록 부재를 이미 인정한다 | `form-export.manager.ts:53` |
| `accept()` 는 조건 없이 INSERT 한다 — 중복 제거가 전혀 없다 | `form-export.manager.ts:26-46` |
| 잡 TTL 은 30일 | `FORM_EXPORT_TTL_DAYS = 30` (`form-export.manager.ts:10`) |
| 워커는 10초 틱 + `isProcessing` 가드 + 틱당 `claim()` 1건 → **인스턴스당 동시 조립 1건** | `form-export-job.worker.ts:33-44` |
| `claim()` 자격 = `status IN ('queued','running') AND (lease_until IS NULL OR lease_until < NOW())` | `form-export-job.manager.ts` `claim` |
| `recordJobError` 는 lease 를 안 지운다 → **재시도 주기가 틱이 아니라 lease(30분)** | `form-export-job.manager.ts:28` |
| 상한 3회 → 결론까지 약 90분 | `MAX_CONSECUTIVE_EXPORT_FAILURES = 3` (`:35`) |

### 2.2 30분 lease 는 재시도용이 아니다 — 이 스펙의 핵심 제약

`DEFAULT_EXPORT_LEASE_MS = 1_800_000` 은 **조립 중 점유**를 지키는 값이다. 짧게 잡으면 살아있는 워커의 잡을 다른 틱이 뺏어가 이중 조립·이중 업로드가 되고, **file-service 에 고아 정리 잡이 없어 진 쪽 xlsx 가 영구 고아로 남는다** (`form-export-job.manager.ts:18-23`).

즉 한 컬럼(`lease_until`)이 **점유 보호**와 **재시도 대기**를 겸하고 있고, 재시도만 줄이려면 둘을 분리해야 한다. **lease 상수를 낮추는 것은 오답이다.**

### 2.3 `recordJobError` 는 CAS 없이 id 로만 쓴다

코드가 이 트레이드오프를 알면서 받아들이고 있다(`:31-33`) — 그 결과 좀비 워커가 **후임의 살아있는 잡** 카운터를 올려 잘못 `failed` 로 확정시킬 수 있다. §3.3 이 이걸 같이 닫는다.

### 2.4 마이그레이션이 필요 없다

`product_form_exports` 에 이미 있는 컬럼: `requested_by` · `requested_master_ids`(`uuid[]`) · `consecutive_failures`(`:33`) · `lease_until` · `lease_token` · `created_at`(`:36`) · `expires_at`. 이 스펙이 쓰는 것이 전부 여기 있다.

### 2.5 화면

| 사실 | 근거 |
|---|---|
| 모달은 닫힐 때 `exportId` 를 버린다 | `form-export-modal/index.tsx:78` |
| 모달은 열릴 때마다 새 요청을 보낸다 | `form-export-modal/index.tsx:81-82` |
| `errorMessage` 는 `status === 'failed'` 일 때만 그린다 | `form-export-modal/index.tsx:159` |
| 세션 목록은 `?page=&limit=` 관례를 이미 쓴다 | `bulk-session.controller.ts:93` |
| 빈 양식 다운로드 버튼은 세션 목록 헤더에 있다 | `session-list/index.tsx:90` |
| admin-web 은 **컴포넌트 테스트가 불가능**하다(렌더러 없음). 판정은 `.ts` 순수 함수로 뽑아야 검증된다 | `excel-download-model.spec.ts` · `session-labels.spec.ts` 선례 |

## 3. 설계

### 3.1 목록 API

`GET /product-forms?page=1&limit=20` — 세션 목록의 관례를 그대로 따른다(같은 페이지 파싱 규칙, 같은 `{ items, total, page, limit }`).

**`parsePage`/`parseLimit` 은 공용 헬퍼가 아니다** — `bulk-session.controller.ts:41-47` 의 모듈 지역 함수다. 두 컨트롤러가 같은 규칙을 써야 하므로 bulk-session 폴더 안의 작은 공용 모듈로 **추출**한다(복제하지 않는다). `parseImageLimit`(`:50`)은 상한이 달라 그대로 둔다.

- 본인 것만(`requestedBy = userId`), `created_at DESC`
- 라우트 순서는 안전하다 — `@Get()` 는 기존 `@Get('blank')`·`@Get(':exportId')` 와 충돌하지 않는다
- 항목: `exportId` · `status` · `requestedCount` · `productCount` · `errorMessage` · `consecutiveFailures` · `downloadable` · `createdAt` · `expiresAt`

`requestedCount`(= `requested_master_ids` 길이)가 있어야 "요청 500건 중 480건 담김 — 20건은 판매 중인 버전 없음"을 목록에서 설명할 수 있다.

### 3.2 중복 제거

`accept()` 가 INSERT 전에 내 진행 중 잡을 찾는다: `requestedBy = me AND status IN ('queued','running')`. 보통 0~2건이므로 **JS 에서 집합 비교**한다.

**SQL 배열 동등 비교를 쓰지 않는 이유:** 그러려면 저장 시 정렬이 전제인데, 현재는 `[...new Set(masterIds)]` 로 중복만 제거하고 정렬하지 않아 **이미 쌓인 행들이 영영 매칭되지 않는다.** 집합 비교는 그 문제도, 선택 순서가 다른 경우도 함께 없앤다.

응답에 `reused: boolean` 을 더한다 — 없으면 사용자는 왜 새 잡이 안 생겼는지 알 수 없다.

**완료된 잡은 재사용하지 않는다.** 그 사이 상품 데이터가 바뀌었을 수 있어 새로 뽑는 게 맞다.

### 3.3 재시도와 점유 분리

`recordJobError(exportId, leaseToken, message)` 로 시그니처를 바꾸고 CAS 를 건다:

```
WHERE id = ? AND lease_token = ? AND status NOT IN ('completed','failed')
SET   consecutive_failures = consecutive_failures + 1,
      error_message = ?,
      lease_until = NOW() + FORM_EXPORT_RETRY_DELAY_MS
```

**왜 이 시점에 lease 를 줄여도 안전한가:** `recordJobError` 는 예외가 던져진 **뒤에** 불린다. 그 순간 조립은 이미 끝났고, lease 의 점유 보호 역할도 끝났다. 유일한 예외가 좀비 워커인데 그게 정확히 CAS 가 막는 것이다.

- 0행 매치 = 좀비 → 경고 로그만, **아무것도 쓰지 않는다** (§2.3 의 기존 결함이 같이 닫힌다)
- 상한 도달 → `status='failed'`, lease 해제 (기존과 동일)
- `FORM_EXPORT_RETRY_DELAY_MS = 60_000` → 워커 틱 10초 기준 **3회 결론까지 약 2~3분**
- **`DEFAULT_EXPORT_LEASE_MS` 는 손대지 않는다** (§2.2)

워커 `tick()` 은 `claimed.leaseToken` 을 넘기도록 한 줄 바뀐다.

### 3.4 상태 노출

`FormExportStatusDto` 와 목록 항목에 `consecutiveFailures` 를 싣는다. 화면 판정은 `status === 'running' && consecutiveFailures > 0` → **"재시도 대기 중 (n/3)"**. **상태 enum 을 늘리지 않아** 서버 상태 기계가 그대로다.

### 3.5 재시도 라우트

`POST /product-forms/:exportId/retry` 는 원본 행에서 `requestedMasterIds` 를 읽어 **`accept()` 를 그대로 호출**한다. 그래야 중복 제거·응답 모양·`reused` 가 자동으로 똑같이 적용된다.

**원본 상태에 제약을 두지 않는다.** `failed` 든 `completed` 든 "이 집합으로 다시 뽑아줘"는 언제나 정당하고, 노출은 화면이 통제한다. 서버에 제약을 넣으면 화면 표와 서버 표를 둘 다 관리해야 한다.

없는 / 남의 / 만료된 `exportId` 는 전부 **404** — `getStatus` 가 이미 쓰는 관례(소유권 실패를 존재 여부와 합쳐 오라클을 막음)를 따른다.

### 3.6 화면 — 탭

`/mall/bulk-sessions` 를 「**양식 생성**」·「**업로드 세션**」 두 탭으로 나눈다. `?tab=forms` 로 결정하고, **쿼리가 없으면 업로드 세션이 기본**이다(사이드바 동선의 기존 동작 보존).

빈 양식 다운로드 버튼은 「양식 생성」 탭으로 옮긴다 — 양식을 얻는 두 방법(빈 양식 / 상품 프리필)이 한 탭에 모이는 게 맞다. 업로드 모달은 세션 탭에 그대로 둔다.

### 3.7 화면 — 상품 목록에서 새 탭 열기

`form-export-modal/` 전체(`index.tsx`·`request-guard.ts`·`request-guard.spec.ts`)를 지운다. 응답 순서 보호 로직이 통째로 사라지는 게 이 설계의 부수다.

**팝업 차단이 순서를 강제한다.** `window.open` 은 사용자 제스처 핸들러 안에서 **동기적으로** 불러야 차단되지 않으므로, POST 응답을 기다렸다 열 수 없다.

```
클릭 → window.open('/mall/bulk-sessions?tab=forms', '_blank')   ← 동기, 먼저
     → POST /product-forms (원래 탭에서)
     → 원래 탭 토스트로 접수 / 재사용 / 실패를 알림
```

- `window.open` 이 `null` (차단됨) → 토스트 후 같은 탭에서 `router.push` 폴백
- **`exportId` 하이라이트는 포기한다** — 새 탭에 넘기려면 `postMessage` 배선이 필요하다. 새로 접수된 잡은 최신순 목록의 맨 위에 뜨고, **재사용(`reused: true`)된 잡은 더 오래돼 맨 위가 아닐 수 있는데** 그 경우는 토스트가 "이미 진행 중인 요청이 있습니다"로 알리고 목록이 진행 중 잡을 모두 보여주므로 찾는 데 문제가 없다
- 새 탭이라 **상품 선택 상태가 원래 탭에 그대로 남는다**
- 버튼은 요청이 도는 동안 비활성화한다 — §6 의 레이스를 실질적으로 막는 쪽이 여기다

### 3.8 화면 — 목록 행

| 상태 | 표시 | 액션 |
|---|---|---|
| `queued` | 대기 중 | — |
| `running`, `consecutiveFailures = 0` | 생성 중 | — |
| `running`, `> 0` | 재시도 대기 중 (n/3) · 직전 오류 | — |
| `completed` + `downloadable` | 상품 480건 담김 (요청 500건) | 다운로드 |
| `failed` | 실패 · 오류 문구 | 다시 시도 |

폴링은 진행 중 항목이 하나라도 있으면 5초, 없으면 멈춘다(기존 `formExportRefetchInterval` 패턴을 목록용으로 이전). `expiresAt` 을 함께 보여 30일 뒤 사라진다는 걸 알린다.

## 4. 에러 처리

| 상황 | 동작 |
|---|---|
| POST 실패 | 원래 탭 토스트. 새 탭은 이미 열려 목록을 보여주므로 거기서 다시 시도 가능 |
| 팝업 차단 | 토스트 후 같은 탭 `router.push` 폴백 |
| 목록 폴링 실패 | react-query 기본 재시도, 마지막 성공 데이터 유지 |
| 없는/남의/만료된 exportId | 404 |
| 다운로드 URL 요청이 완료 전 | 409 (기존 그대로) |

## 5. 테스트

**서버** — 기존 스펙 파일에 붙인다.

- `form-export.manager.spec.ts`: 진행 중 같은 집합 → 재사용 · **순서만 다른 집합도 재사용**(집합 비교의 핵심) · 완료된 잡은 재사용 안 함 · 다른 집합이면 새 잡 · 목록은 본인 것만·최신순
- `form-export-job.manager.spec.ts`: 토큰 일치 → 실패 기록 + 짧은 lease · **토큰 불일치(좀비) → 0행, 아무것도 쓰지 않음** · 상한 도달 → `failed` + lease 해제
- lease 회귀는 이미 있는 `form-export-job-lease.integration.spec.ts` 에 실 DB 로 붙인다

**admin-web** — 순수 함수 3개(`행 상태 판정`·`폴링 간격`·`탭 파라미터 파싱`)에 `.spec.ts`. **이 함수들로 뽑히지 않은 로직은 검증되지 않는다**(§2.5)를 전제로 설계한다.

## 6. 남기는 것 — 한계 명시

**동시 요청 레이스는 닫히지 않는다.** 두 요청이 같은 밀리초대에 들어오면 중복 잡이 생긴다. 완전히 막으려면 부분 유니크 인덱스가 필요하고 그건 마이그레이션이다. 더블클릭은 프론트 버튼 비활성화로 막고, 탭 간 재요청은 수 초 간격이라 SELECT 가 잡는다. **비용은 중복 잡 한 건**이고 사용자는 목록에서 그걸 본다.

**이미 쌓인 고아 잡이 사용자 눈에 보이게 된다** — 목록이 생기는 즉시. 이건 의도된 결과다(가시성이 목적).

**완료 알림은 만들지 않는다.** 사용자가 목록 화면에서 확인한다(사용자 확정). 전역 인앱 알림·브라우저 알림은 나중에 이 목록 API 위에 그대로 얹을 수 있어 재작업이 생기지 않는다.

## 7. 배포

- **마이그레이션 0건**
- **순서: core 선배포 → admin-web.** 반대면 새 화면이 없는 API 를 부른다
- 서버 변경은 전부 하위호환(기존 라우트 유지, DTO 는 필드 추가만) — 문제가 생기면 **화면만 롤백해도** 기존 모달 동작으로 돌아간다
- 새 secret / env / 이벤트 계약 변경 **없음**
