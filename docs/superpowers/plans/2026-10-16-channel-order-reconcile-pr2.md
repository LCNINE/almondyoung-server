# 채널 주문 대사 PR 2 — admin-web «수집» 칸 합치기와 «채널과 어긋남» 목록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정체 보드 0단계 «수집» 칸이 수집 격리와 «채널과 어긋남»을 함께 세고, 운영자가 `/order/channel-mismatches` 에서 어긋난 주문을 보고 [다시 배달]·[종결]로 닫을 수 있게 한다.

**Architecture:** admin-web 만 바꾼다. PR 1(#1084)이 만든 channel-adapter API 를 기존 수집 격리와 같은 방식(`lib/api/domains/channel/*.client.ts` + 순수 `*.shape.ts`)으로 붙인다. 판정(칸 합산·링크 노출·표시 문구·버튼 노출)은 전부 `.ts` 순수 함수로 뽑아 jest 로 검증하고, `.tsx` 는 배선만 둔다 — admin-web 은 렌더러가 없어 컴포넌트 테스트가 불가능하다.

**Tech Stack:** Next.js(app router) · TanStack Query v5 · axios(`lib/api/client.ts` 인터셉터) · sonner · shadcn ui · jest(ts-jest, 루트 설정)

**Spec:** `docs/superpowers/specs/2026-10-16-channel-order-reconcile-design.md` — 이번 범위는 §8 «보이기와 사람의 출구». 맨 위 «계획 단계 정정» 블록도 함께 읽는다. API 모양의 출처는 PR 1 계획 `docs/superpowers/plans/2026-10-16-channel-order-reconcile-pr1.md` 와 정본 코드 `apps/channel-adapter/src/controllers/order-reconcile-findings.controller.ts` · `apps/channel-adapter/src/schema.ts`(`orderReconcileFindings`).

## Global Constraints

- 바꾸는 앱은 `apps/admin-web` 하나다. 마이그레이션 없음. channel-adapter·core 코드는 건드리지 않는다.
- 판정·문구는 `.ts` 순수 함수로 두고 스펙을 붙인다. 순수 모듈은 `@tanstack/*`·`axios`·`sonner`·`next/*` 를 **값으로** import 하지 않는다(루트 jest 가 수집하는데 CI 는 그 의존성을 루트에 안 깐다. `import type` 은 안전).
- TanStack 쿼리키에 `undefined` 를 넣지 않는다. 무효화는 접두사 키(`['order-reconcile-findings']`)로 한다 — `partialMatchKey` 가 위치별 비교라 `['x', undefined]` 는 아무것도 무효화하지 못한다.
- 요약을 못 읽으면 0 이 아니라 «알 수 없음»(`null`, 칸엔 `—`)이다. 목록·요약 응답 모양이 다르면 빈 목록·0 으로 그리지 말고 오류로 만든다.
- UI 글씨는 필요한 것만. 정상 상태(0건)는 숨긴다. 설명 캡션·범례를 깔지 않는다.
- 보드 자체엔 조치 버튼을 두지 않는다(정체 보드 D8). 조치는 목록 화면에만.
- 목록은 메뉴(`lib/utils/menu.ts`)에 넣지 않는다. 보드에서만 들어온다.
- 조치 버튼([다시 배달]·[종결])은 **`status = 'open'` 이고 `handling = 'human'` 인 행에만** 보인다(스펙 §8.2 «사람 행에만, admin·master»). 페이지는 `RouteGuard requireRole={['admin', 'master']}`.
- 종결 메모: 앞뒤 공백을 뺀 값이 1~500자(서버 `CloseFindingDto` 의 `@MinLength(1) @MaxLength(500)`).
- 타입 게이트는 `cd apps/admin-web && npx tsc --noEmit` 이다. 루트 `npm run type-check` 는 `apps/admin-web` 을 `exclude` 해서 이 앱을 안 보고, CI 도 admin-web tsc 를 돌리지 않는다.
- `.tsx` 는 `npm run lint` 글롭 밖이다. 바꾼 `.tsx` 는 `npx eslint <파일>` 로 직접 본다.
- 스펙에서 `@/` 별칭 값 import 는 된다(루트 jest `moduleNameMapper` 에 `^@/(.*)$` 가 있다).

## Review Focus

1. **어긋남 요약만 실패하고 격리 요약은 성공** — 칸 숫자를 격리 건수만으로 그리면 적게 세어 «정상»으로 읽힌다. 칸은 `—`, 격리 링크는 건수와 함께, 어긋남 링크는 건수 없이 보여야 한다. → Task 2 `collectCell` 스펙.
2. **응답 모양이 예상과 다름**(인터셉터 술어가 바뀌거나 서버가 envelope 를 바꿈) — 목록이 «어긋난 주문 없음»으로, 요약이 0 으로 보이면 안 된다. 오류로 떠야 한다. → Task 1 shape 스펙(`null` 반환) + 클라이언트가 `null` 을 throw.
3. **[다시 배달]이 서버에서 실패(500)** — 서버는 실패도 시도로 기록한다(`recordAttempt(id, 'error: …')`). 화면이 성공일 때만 무효화하면 시도 수·마지막 결과가 옛 값으로 남는다. → Task 1 뮤테이션은 `onSettled` 로 무효화.
4. **[다시 배달]이 409**(«이벤트 실패 화면에서 먼저 처리» 등 네 문구) — 서버 문구를 그대로 보여야 하고, 504(프록시 30초)는 «실패»라고 하지 않는다. → Task 3 `actionErrorText` 재사용, Task 4 배선.
5. **보낸 게 아닌 결과**(`not_found`·`not_eligible`·`no_mapping`·`nothing_to_send`·`unchanged` 등, HTTP 200) — 성공 토스트로 띄우면 운영자가 «보냈다»고 믿고 떠난다. → Task 3 `redeliverOutcome` 스펙.

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| Create `apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.ts` | 응답 → 화면 타입 순수 정형화. 모양이 다르면 `null` |
| Create `apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts` | 위 스펙 |
| Create `apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.client.ts` | axios 호출. `null` 을 오류로 바꾼다 |
| Modify `apps/admin-web/src/lib/services/channel/query-keys.ts` | 어긋남 키 셋 |
| Create `apps/admin-web/src/lib/services/channel/query-keys.spec.ts` | 키에 `undefined` 없음·접두사 |
| Modify `apps/admin-web/src/lib/services/channel/queries.ts` | `useMismatchSummary`·`useMismatches` |
| Modify `apps/admin-web/src/lib/services/channel/mutations.ts` | `useRedeliverMismatch`·`useCloseMismatch` |
| Create `apps/admin-web/src/features/order/stall-board/collect-cell.ts` | 0단계 칸 합산·링크 판정 |
| Create `apps/admin-web/src/features/order/stall-board/collect-cell.spec.ts` | 위 스펙 |
| Modify `apps/admin-web/src/features/order/stall-board/template/index.tsx` | 배선 |
| Create `apps/admin-web/src/features/order/channel-mismatches/display.ts` | 목록 표시 문구·버튼 노출·메모 검증 |
| Create `apps/admin-web/src/features/order/channel-mismatches/display.spec.ts` | 위 스펙 |
| Create `apps/admin-web/src/features/order/channel-mismatches/components/close-dialog.tsx` | 종결 대화상자 |
| Create `apps/admin-web/src/features/order/channel-mismatches/template/index.tsx` | 목록 화면 |
| Create `apps/admin-web/src/app/(admin)/order/channel-mismatches/page.tsx` | 라우트 + 역할 가드 |
| Modify `apps/admin-web/src/components/common/breadcrumb-items.ts` · `breadcrumb-items.spec.ts` | «채널과 어긋남» 빵부스러기 |

---

### Task 1: API 모양·클라이언트·쿼리키·훅

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.ts`
- Create: `apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts`
- Create: `apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.client.ts`
- Modify: `apps/admin-web/src/lib/services/channel/query-keys.ts`
- Create: `apps/admin-web/src/lib/services/channel/query-keys.spec.ts`
- Modify: `apps/admin-web/src/lib/services/channel/queries.ts`
- Modify: `apps/admin-web/src/lib/services/channel/mutations.ts`

**Interfaces:**
- Consumes: 없음(첫 태스크). 서버 API 는 위 «Spec» 의 컨트롤러.
- Produces:
  - shape: `type FindingKind = 'missing_order' | 'cancel_not_applied'`, `type FindingHandling = 'auto' | 'human'`, `type HumanReason = 'out_of_window' | 'core_status' | 'event_failure_open' | 'attempts_exhausted'`, `type FindingStatus = 'open' | 'resolved' | 'closed'`, `interface ReconcileFindingDto`, `interface ReconcileSummary { open: number; human: number; gaveUp: number; oldestFirstSeenAt: string | null }`, `type MismatchListScope = 'open' | 'all'`, `interface MismatchListResult { data: ReconcileFindingDto[]; truncated: boolean }`, `const MISMATCH_LIST_LIMIT = 200`, `toMismatchList(body: unknown, limit?: number): MismatchListResult | null`, `toMismatchSummary(body: unknown): ReconcileSummary | null`, `toRedeliverResult(body: unknown): string | null`, `toClosedFinding(body: unknown): ReconcileFindingDto | null`
  - client: `orderReconcileFindingsClient.{ summary(): Promise<ReconcileSummary>; list(scope: MismatchListScope): Promise<MismatchListResult>; redeliver(id: string): Promise<string>; close(id: string, memo: string): Promise<ReconcileFindingDto> }`
  - keys: `channelQueryKeys.mismatches` · `channelQueryKeys.mismatchSummary` · `channelQueryKeys.mismatchList(scope: MismatchListScope)`
  - hooks: `useMismatchSummary()` · `useMismatches(scope: MismatchListScope)` (queries.ts), `useRedeliverMismatch()` (mutationFn `(id: string)`) · `useCloseMismatch()` (mutationFn `({ id, memo }: { id: string; memo: string })`) (mutations.ts)

- [ ] **Step 0: 워크트리 (첫 태스크에서만)**

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin && git status   # develop, clean 이어야 한다
git worktree add .claude/worktrees/feat-1016-45-channel-mismatch-screen -b feat/1016-45-channel-mismatch-screen develop
cd .claude/worktrees/feat-1016-45-channel-mismatch-screen
ln -s ../../../node_modules node_modules
ln -s ../../../../../apps/admin-web/node_modules apps/admin-web/node_modules
ln -s ../../../../../native/warehouse-app/node_modules native/warehouse-app/node_modules
ls -la node_modules apps/admin-web/node_modules native/warehouse-app/node_modules | head -3
```

기준선을 먼저 잰다(이 값이 이후 «0 증가»의 기준이다):

```bash
(cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -c 'error TS')
```

Expected: `0`. 0 이 아니면(예: `sanitize-html` 미설치 1건) 그 목록을 PR 본문에 적어 두고 이후 태스크는 «기준선에서 늘지 않음»으로 판정한다.

- [ ] **Step 1: shape 스펙을 쓴다(실패)**

`apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts`:

```ts
import {
  MISMATCH_LIST_LIMIT,
  type ReconcileFindingDto,
  toClosedFinding,
  toMismatchList,
  toMismatchSummary,
  toRedeliverResult,
} from './order-reconcile-findings.shape';

const finding: ReconcileFindingDto = {
  id: '0192f0c0-0000-7000-8000-000000000001',
  channel: 'medusa',
  externalOrderId: 'order_01',
  displayOrderNo: '1042',
  kind: 'missing_order',
  status: 'open',
  handling: 'human',
  humanReason: 'out_of_window',
  coreStatus: null,
  channelCreatedAt: '2026-10-01T00:00:00.000Z',
  mode: 'observe',
  lastResult: 'skipped',
  attemptCount: 0,
  firstSeenAt: '2026-10-16T09:30:00.000Z',
  lastSeenAt: '2026-10-16T10:00:00.000Z',
  lastAttemptAt: null,
  resolvedAt: null,
  closedAt: null,
  closedBy: null,
  closeMemo: null,
};

describe('toMismatchList', () => {
  it('인터셉터가 벗긴 배열·envelope·data 한 겹을 모두 읽는다', () => {
    const expected = { data: [finding], truncated: false };
    expect(toMismatchList([finding])).toEqual(expected);
    expect(toMismatchList({ success: true, data: [finding] })).toEqual(expected);
    expect(toMismatchList({ data: [finding] })).toEqual(expected);
  });
  it('상한에 닿으면 truncated', () => {
    expect(toMismatchList([finding, finding], 2)?.truncated).toBe(true);
    expect(MISMATCH_LIST_LIMIT).toBe(200);
  });
  it('모양이 다르면 null — 빈 목록으로 그리면 «어긋난 주문 없음»으로 읽힌다', () => {
    expect(toMismatchList('x')).toBeNull();
    expect(toMismatchList({})).toBeNull();
    expect(toMismatchList({ success: true, data: { open: 1 } })).toBeNull();
  });
});

describe('toMismatchSummary', () => {
  const summary = { open: 3, human: 1, gaveUp: 1, oldestFirstSeenAt: '2026-10-16T09:30:00.000Z' };
  it('벗긴 몸통과 envelope 둘 다 읽는다', () => {
    expect(toMismatchSummary(summary)).toEqual(summary);
    expect(toMismatchSummary({ success: true, data: summary, timestamp: 'x' })).toEqual(summary);
  });
  it('oldestFirstSeenAt 이 문자열이 아니면 null 로 둔다', () => {
    expect(toMismatchSummary({ ...summary, oldestFirstSeenAt: null })).toEqual({ ...summary, oldestFirstSeenAt: null });
  });
  it('건수가 숫자가 아니면 null — 0 으로 보면 «정상»으로 읽힌다', () => {
    expect(toMismatchSummary('x')).toBeNull();
    expect(toMismatchSummary({ open: 3 })).toBeNull();
    expect(toMismatchSummary({ quarantined: 3, oldestCreatedAt: null })).toBeNull();
  });
});

describe('toRedeliverResult', () => {
  it('인터셉터를 안 거친 { result } 와 감싼 모양 둘 다', () => {
    expect(toRedeliverResult({ result: 'enqueued' })).toBe('enqueued');
    expect(toRedeliverResult({ success: true, data: { result: 'not_found' } })).toBe('not_found');
  });
  it('모양이 다르면 null', () => {
    expect(toRedeliverResult({})).toBeNull();
    expect(toRedeliverResult({ result: 3 })).toBeNull();
  });
});

describe('toClosedFinding', () => {
  it('{ data: 행 } 과 행 자체 둘 다', () => {
    const closed = { ...finding, status: 'closed' as const, closeMemo: '셀메이트로 나감' };
    expect(toClosedFinding({ data: closed })).toEqual(closed);
    expect(toClosedFinding(closed)).toEqual(closed);
  });
  it('모양이 다르면 null', () => {
    expect(toClosedFinding({ data: null })).toBeNull();
    expect(toClosedFinding('x')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile-findings.shape'`

- [ ] **Step 3: shape 구현**

`apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.ts`:

```ts
// src/lib/api/domains/channel/order-reconcile-findings.shape.ts
//
// «채널과 어긋남»(#1016 45번) 응답의 순수 정형화 함수. axios·react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능해서 이 함수들만 스펙으로 검증된다.
//
// 서버 원형은 apps/channel-adapter/src/controllers/order-reconcile-findings.controller.ts.
// 공용 인터셉터(`lib/api/client.ts`)는 `success === true && 'data' in body` 일 때만 한 겹 벗긴다:
//
// | 호출 | 서버 본문 | 인터셉터 통과 후 |
// |---|---|---|
// | `GET /`               | `{ success, data }`            | `data` (배열) |
// | `GET /summary`        | `{ success, data, timestamp }` | `data` (요약) |
// | `POST /:id/redeliver` | `{ result }`                   | 그대로 (`success` 가 없다) |
// | `POST /:id/close`     | `{ data }`                     | 그대로 (`success` 가 없다) |
//
// 그래서 «`data` 키가 있으면 한 겹 벗긴다» 하나로 두 모양을 다 받는다(행·요약·결과엔 `data` 키가 없다).
// 모양이 다르면 null 이다 — 빈 목록이나 0 으로 그리면 운영자가 «어긋난 주문 없음»으로 읽는다.

export type FindingKind = 'missing_order' | 'cancel_not_applied';
export type FindingHandling = 'auto' | 'human';
export type HumanReason =
  | 'out_of_window'
  | 'core_status'
  | 'event_failure_open'
  | 'attempts_exhausted';
export type FindingStatus = 'open' | 'resolved' | 'closed';

/** `order_reconcile_findings` 행 하나 (apps/channel-adapter/src/schema.ts). 시각은 JSON 이라 ISO 문자열이다. */
export interface ReconcileFindingDto {
  id: string;
  channel: string;
  externalOrderId: string;
  displayOrderNo: string | null;
  kind: FindingKind;
  status: FindingStatus;
  handling: FindingHandling;
  humanReason: HumanReason | null;
  coreStatus: string | null;
  channelCreatedAt: string;
  mode: 'observe' | 'act';
  lastResult: string | null;
  attemptCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAttemptAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeMemo: string | null;
}

export interface ReconcileSummary {
  open: number;
  human: number;
  gaveUp: number;
  oldestFirstSeenAt: string | null;
}

/** 서버 상한(200)과 같게 보낸다. 서버 기본 50 이면 말없이 앞 50건만 보인다. */
export const MISMATCH_LIST_LIMIT = 200;

/** 화면 토글의 두 값. 서버는 resolved·closed 를 따로도 받지만 화면은 «열린 것»과 «전부»만 쓴다. */
export type MismatchListScope = 'open' | 'all';

export interface MismatchListResult {
  data: ReconcileFindingDto[];
  /** 상한에 닿았다 — 뒤에 더 있을 수 있다. */
  truncated: boolean;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function unwrap(body: unknown): unknown {
  const record = asRecord(body);
  return record && 'data' in record ? record.data : body;
}

export function toMismatchList(
  body: unknown,
  limit: number = MISMATCH_LIST_LIMIT
): MismatchListResult | null {
  const value = unwrap(body);
  if (!Array.isArray(value)) return null;
  const rows = value as ReconcileFindingDto[];
  return { data: rows, truncated: rows.length >= limit };
}

export function toMismatchSummary(body: unknown): ReconcileSummary | null {
  const v = asRecord(unwrap(body));
  if (
    !v ||
    typeof v.open !== 'number' ||
    typeof v.human !== 'number' ||
    typeof v.gaveUp !== 'number'
  )
    return null;
  return {
    open: v.open,
    human: v.human,
    gaveUp: v.gaveUp,
    oldestFirstSeenAt:
      typeof v.oldestFirstSeenAt === 'string' ? v.oldestFirstSeenAt : null,
  };
}

export function toRedeliverResult(body: unknown): string | null {
  const v = asRecord(unwrap(body));
  return v && typeof v.result === 'string' ? v.result : null;
}

export function toClosedFinding(body: unknown): ReconcileFindingDto | null {
  const v = asRecord(unwrap(body));
  return v && typeof v.id === 'string'
    ? (v as unknown as ReconcileFindingDto)
    : null;
}
```

(`as` 두 곳은 형제 파일 `order-collection-failures.shape.ts` 와 같은 경계 캐스팅이다 — 서버 행을 런타임 검증 없이 타입으로 받는 유일한 자리.)

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts`
Expected: PASS (4 describe, 10 tests)

- [ ] **Step 5: 쿼리키 스펙(실패)**

`apps/admin-web/src/lib/services/channel/query-keys.spec.ts`:

```ts
import { channelQueryKeys } from './query-keys';

describe('channelQueryKeys — 채널과 어긋남', () => {
  const keys = [
    channelQueryKeys.mismatchSummary,
    channelQueryKeys.mismatchList('open'),
    channelQueryKeys.mismatchList('all'),
  ];

  it('목록·요약 키는 무효화 접두사로 시작한다 — 접두사 하나로 둘 다 갱신된다', () => {
    const prefix = channelQueryKeys.mismatches;
    for (const key of keys) expect(key.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it('키에 undefined 가 없다 — 있으면 위치별 비교라 무효화가 조용히 빗나간다', () => {
    for (const key of keys) expect(key).not.toContain(undefined);
  });

  it('격리 키와 접두사가 다르다 — 격리 무효화가 어긋남 목록을 흔들지 않는다', () => {
    expect(channelQueryKeys.mismatches[0]).not.toBe(channelQueryKeys.failures[0]);
  });
});
```

Run: `npx jest apps/admin-web/src/lib/services/channel/query-keys.spec.ts`
Expected: FAIL — `channelQueryKeys.mismatchSummary` 가 없어 `TypeError`(또는 `toEqual` 실패)

- [ ] **Step 6: 쿼리키 구현**

`apps/admin-web/src/lib/services/channel/query-keys.ts` 를 통째로:

```ts
// src/lib/services/channel/query-keys.ts
// 주문 수집 실패(미매핑 주문) 격리 큐와 «채널과 어긋남»(#1016 45번) 쿼리 키 팩토리

import type { MismatchListScope } from '@/lib/api/domains/channel/order-reconcile-findings.shape';

export const channelQueryKeys = {
  failures: ['order-collection-failures'] as const,
  summary: ['order-collection-failures', 'summary'] as const,
  failuresList: (query: Record<string, unknown>) =>
    [...channelQueryKeys.failures, 'list', query] as const,
  failure: (id: string) => [...channelQueryKeys.failures, id] as const,

  // 뮤테이션은 `mismatches` 접두사로 목록·요약을 함께 무효화한다 — 하위 키에 undefined 를 섞지 않는다.
  mismatches: ['order-reconcile-findings'] as const,
  mismatchSummary: ['order-reconcile-findings', 'summary'] as const,
  mismatchList: (scope: MismatchListScope) =>
    ['order-reconcile-findings', 'list', scope] as const,
};
```

Run: `npx jest apps/admin-web/src/lib/services/channel/query-keys.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: 클라이언트**

`apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.client.ts`:

```ts
'use client';

// src/lib/api/domains/channel/order-reconcile-findings.client.ts
// «채널과 어긋남»(#1016 45번) API 클라이언트. 모양 맞추기는 전부 `./order-reconcile-findings.shape` 가 한다.
//
// shape 가 null 을 주면 여기서 throw 한다 — 쿼리가 isError 로 남아야 보드 칸이 «알 수 없음»(—)이 되고
// 목록이 «불러오지 못했습니다»가 된다. 0·빈 목록으로 흘리면 «정상»으로 읽힌다.

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import {
  MISMATCH_LIST_LIMIT,
  toClosedFinding,
  toMismatchList,
  toMismatchSummary,
  toRedeliverResult,
} from './order-reconcile-findings.shape';
import type {
  MismatchListResult,
  MismatchListScope,
  ReconcileFindingDto,
  ReconcileSummary,
} from './order-reconcile-findings.shape';

const BASE = `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-reconcile-findings`;

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} 응답 모양이 예상과 다릅니다`);
  return value;
}

export const orderReconcileFindingsClient = {
  summary: async (): Promise<ReconcileSummary> => {
    const response = await client.get(`${BASE}/summary`);
    return required(toMismatchSummary(response.data), '어긋남 요약');
  },

  list: async (scope: MismatchListScope): Promise<MismatchListResult> => {
    const response = await client.get(BASE, {
      params: { status: scope, limit: MISMATCH_LIST_LIMIT },
    });
    return required(toMismatchList(response.data), '어긋남 목록');
  },

  /** 결과 문자열(`enqueued`·`not_found` …). 막히면 서버가 409 와 한국어 문구를 준다 */
  redeliver: async (id: string): Promise<string> => {
    const response = await client.post(`${BASE}/${encodeURIComponent(id)}/redeliver`);
    return required(toRedeliverResult(response.data), '다시 배달');
  },

  close: async (id: string, memo: string): Promise<ReconcileFindingDto> => {
    const response = await client.post(`${BASE}/${encodeURIComponent(id)}/close`, { memo });
    return required(toClosedFinding(response.data), '종결');
  },
};
```

- [ ] **Step 8: 쿼리 훅**

`apps/admin-web/src/lib/services/channel/queries.ts` — import 에 한 줄 더하고 파일 끝에 두 훅을 더한다.

import 블록(기존 `orderCollectionFailuresClient` import 아래):

```ts
import { orderReconcileFindingsClient } from '@/lib/api/domains/channel/order-reconcile-findings.client';
import type { MismatchListScope } from '@/lib/api/domains/channel/order-reconcile-findings.shape';
```

파일 끝:

```ts
/** 정체 보드 0단계 — 열린 «채널과 어긋남» 요약. 못 읽으면 isError 로 남는다(0 으로 보지 않는다). */
export function useMismatchSummary() {
  return useQuery({
    queryKey: channelQueryKeys.mismatchSummary,
    queryFn: () => orderReconcileFindingsClient.summary(),
    refetchInterval: 60_000,
  });
}

/** «채널과 어긋남» 목록. 기본은 열린 것만, 토글로 해소·종결까지 */
export function useMismatches(scope: MismatchListScope) {
  return useQuery({
    queryKey: channelQueryKeys.mismatchList(scope),
    queryFn: () => orderReconcileFindingsClient.list(scope),
  });
}
```

- [ ] **Step 9: 뮤테이션 훅**

`apps/admin-web/src/lib/services/channel/mutations.ts` — import 한 줄과 훅 둘을 더한다.

```ts
import { orderReconcileFindingsClient } from '@/lib/api/domains/channel/order-reconcile-findings.client';
```

```ts
/**
 * [다시 배달]. 성공·실패와 무관하게 무효화한다 — 서버는 실패(500)도 시도로 기록하므로
 * (`recordAttempt(id, 'error: …')`) 성공일 때만 갱신하면 시도 수·마지막 결과가 옛 값으로 남는다.
 */
export function useRedeliverMismatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderReconcileFindingsClient.redeliver(id),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.mismatches,
      });
    },
  });
}

export function useCloseMismatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, memo }: { id: string; memo: string }) =>
      orderReconcileFindingsClient.close(id, memo),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: channelQueryKeys.mismatches,
      });
    },
  });
}
```

- [ ] **Step 10: 타입·스펙 확인**

```bash
(cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -c 'error TS')   # Step 0 기준선과 같아야 한다
npx jest apps/admin-web/src/lib/api/domains/channel apps/admin-web/src/lib/services/channel
```

Expected: tsc 기준선 그대로, jest PASS. CI 조건(루트에 `@tanstack` 없음)에서도 도는지:

```bash
npx jest apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts apps/admin-web/src/lib/services/channel/query-keys.spec.ts --moduleNameMapper '{"^@tanstack/(.*)$":"<rootDir>/__does_not_exist__/$1","^@/(.*)$":"<rootDir>/apps/admin-web/src/$1"}'
```

Expected: PASS (스펙이 app 전용 의존성을 값으로 끌어오지 않는다는 뜻).

- [ ] **Step 11: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.ts \
  apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.shape.spec.ts \
  apps/admin-web/src/lib/api/domains/channel/order-reconcile-findings.client.ts \
  apps/admin-web/src/lib/services/channel/query-keys.ts \
  apps/admin-web/src/lib/services/channel/query-keys.spec.ts \
  apps/admin-web/src/lib/services/channel/queries.ts \
  apps/admin-web/src/lib/services/channel/mutations.ts
git commit -m "feat(admin-web): 채널과 어긋남 API 클라이언트·쿼리 훅 (#1016 45번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 2: 정체 보드 0단계 «수집» 칸 합치기

**Files:**
- Create: `apps/admin-web/src/features/order/stall-board/collect-cell.ts`
- Create: `apps/admin-web/src/features/order/stall-board/collect-cell.spec.ts`
- Modify: `apps/admin-web/src/features/order/stall-board/template/index.tsx`

**Interfaces:**
- Consumes: `QuarantineSummary`(기존 `order-collection-failures.shape`), `ReconcileSummary`·`useMismatchSummary`(Task 1), `useQuarantineSummary`(기존), `BandCell`(기존 `components/stage-band.tsx`, `import type`)
- Produces: `type Known<T> = { ok: true; data: T } | { ok: false }`, `known<T>(query: { isSuccess: boolean; data: T | undefined }): Known<T>`, `interface CollectLink { href: string; label: string; count: number | null }`, `collectCell(quarantine: Known<QuarantineSummary>, mismatch: Known<ReconcileSummary>): { cell: BandCell; links: CollectLink[] }`, `const MISMATCH_LIST_PATH = '/order/channel-mismatches'`

- [ ] **Step 1: 스펙(실패)**

`apps/admin-web/src/features/order/stall-board/collect-cell.spec.ts`:

```ts
import { collectCell, known, MISMATCH_LIST_PATH } from './collect-cell';

const quarantine = { quarantined: 3, oldestCreatedAt: '2026-10-10T00:00:00.000Z' };
const mismatch = { open: 2, human: 1, gaveUp: 1, oldestFirstSeenAt: '2026-10-09T00:00:00.000Z' };
const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = { ok: false as const };

describe('collectCell — 정체 보드 0단계 (스펙 §8.1)', () => {
  it('open = 격리 + 열린 불일치, stuck = 격리 + human, gaveUp = 소진, 최장 = 둘 중 이른 쪽', () => {
    const { cell, links } = collectCell(ok(quarantine), ok(mismatch));
    expect(cell).toEqual({
      key: 'collect',
      open: 5,
      stuck: 4,
      gaveUp: 1,
      oldestAt: '2026-10-09T00:00:00.000Z',
    });
    expect(links).toEqual([
      { href: '/mall/channel-listings', label: '수집 격리', count: 3 },
      { href: MISMATCH_LIST_PATH, label: '채널과 어긋남', count: 2 },
    ]);
  });

  it('어긋남 요약을 못 읽으면 칸은 알 수 없음 — 격리만 세면 적게 세어 정상으로 읽힌다', () => {
    const { cell, links } = collectCell(ok(quarantine), fail);
    expect(cell.open).toBeNull();
    expect(links).toEqual([
      { href: '/mall/channel-listings', label: '수집 격리', count: 3 },
      { href: MISMATCH_LIST_PATH, label: '채널과 어긋남', count: null },
    ]);
  });

  it('격리 요약을 못 읽어도 칸은 알 수 없음이고 격리 링크는 남는다', () => {
    const { cell, links } = collectCell(fail, ok(mismatch));
    expect(cell.open).toBeNull();
    expect(links.map((l) => [l.label, l.count])).toEqual([
      ['수집 격리', null],
      ['채널과 어긋남', 2],
    ]);
  });

  it('0 인 쪽 링크는 숨긴다', () => {
    const zeroQ = { quarantined: 0, oldestCreatedAt: null };
    const zeroM = { open: 0, human: 0, gaveUp: 0, oldestFirstSeenAt: null };
    expect(collectCell(ok(zeroQ), ok(mismatch)).links.map((l) => l.label)).toEqual(['채널과 어긋남']);
    expect(collectCell(ok(quarantine), ok(zeroM)).links.map((l) => l.label)).toEqual(['수집 격리']);
    const both = collectCell(ok(zeroQ), ok(zeroM));
    expect(both.links).toEqual([]);
    expect(both.cell).toEqual({ key: 'collect', open: 0, stuck: 0, gaveUp: 0, oldestAt: null });
  });

  it('최장은 한쪽만 있으면 그쪽, 깨진 시각은 무시한다', () => {
    const noOldestM = { ...mismatch, oldestFirstSeenAt: null };
    expect(collectCell(ok(quarantine), ok(noOldestM)).cell.oldestAt).toBe(quarantine.oldestCreatedAt);
    const badQ = { ...quarantine, oldestCreatedAt: 'not-a-date' };
    expect(collectCell(ok(badQ), ok(mismatch)).cell.oldestAt).toBe(mismatch.oldestFirstSeenAt);
  });
});

describe('known', () => {
  it('성공이고 값이 있을 때만 ok', () => {
    expect(known({ isSuccess: true, data: 1 })).toEqual({ ok: true, data: 1 });
    expect(known({ isSuccess: false, data: undefined })).toEqual({ ok: false });
    expect(known({ isSuccess: true, data: undefined })).toEqual({ ok: false });
  });
});
```

Run: `npx jest apps/admin-web/src/features/order/stall-board/collect-cell.spec.ts`
Expected: FAIL — `Cannot find module './collect-cell'`

- [ ] **Step 2: 구현**

`apps/admin-web/src/features/order/stall-board/collect-cell.ts`:

```ts
// 정체 보드 0단계 «수집» 칸 (#1016 45번 스펙 §8.1). 수집 격리 요약과 «채널과 어긋남» 요약을 합친다.
// 어느 한쪽이라도 못 읽으면 칸 숫자는 «알 수 없음»(null) — 아는 쪽만 보이면 적게 세어 «정상»으로 읽힌다.
// React·react-query 를 import 하지 않는다(admin-web 은 컴포넌트 테스트가 불가능하다).

import type { BandCell } from './components/stage-band';
import type { QuarantineSummary } from '@/lib/api/domains/channel/order-collection-failures.shape';
import type { ReconcileSummary } from '@/lib/api/domains/channel/order-reconcile-findings.shape';

export const MISMATCH_LIST_PATH = '/order/channel-mismatches';
const QUARANTINE_LIST_PATH = '/mall/channel-listings';

/** 요약 하나를 읽은 결과. 못 읽었으면 값이 없다 */
export type Known<T> = { ok: true; data: T } | { ok: false };

export function known<T>(query: { isSuccess: boolean; data: T | undefined }): Known<T> {
  return query.isSuccess && query.data !== undefined
    ? { ok: true, data: query.data }
    : { ok: false };
}

export interface CollectLink {
  href: string;
  label: string;
  /** 못 읽었으면 null — 0 인지 모르므로 링크는 남긴다 */
  count: number | null;
}

function earliest(...isos: (string | null)[]): string | null {
  let best: { iso: string; t: number } | null = null;
  for (const iso of isos) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) continue;
    if (!best || t < best.t) best = { iso, t };
  }
  return best?.iso ?? null;
}

export function collectCell(
  quarantine: Known<QuarantineSummary>,
  mismatch: Known<ReconcileSummary>
): { cell: BandCell; links: CollectLink[] } {
  const quarantined = quarantine.ok ? quarantine.data.quarantined : null;
  const mismatchOpen = mismatch.ok ? mismatch.data.open : null;
  const links: CollectLink[] = [
    { href: QUARANTINE_LIST_PATH, label: '수집 격리', count: quarantined },
    { href: MISMATCH_LIST_PATH, label: '채널과 어긋남', count: mismatchOpen },
  ];
  return {
    cell: {
      key: 'collect',
      open:
        quarantined !== null && mismatchOpen !== null
          ? quarantined + mismatchOpen
          : null,
      // 격리는 전부 사람 일(정체 보드 스펙 §6)
      stuck: (quarantined ?? 0) + (mismatch.ok ? mismatch.data.human : 0),
      gaveUp: mismatch.ok ? mismatch.data.gaveUp : 0,
      oldestAt: earliest(
        quarantine.ok ? quarantine.data.oldestCreatedAt : null,
        mismatch.ok ? mismatch.data.oldestFirstSeenAt : null
      ),
    },
    links: links.filter((link) => link.count !== 0),
  };
}
```

- [ ] **Step 3: 통과 확인**

Run: `npx jest apps/admin-web/src/features/order/stall-board/collect-cell.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 4: 보드 배선**

`apps/admin-web/src/features/order/stall-board/template/index.tsx` 에서:

import 를 바꾼다 —

```ts
import { useMismatchSummary, useQuarantineSummary } from '@/lib/services/channel/queries';
import { collectCell, known } from '../collect-cell';
```

(`useQuarantineSummary` 단독 import 줄을 위 첫 줄로 바꾼다.)

`const quarantine = useQuarantineSummary();` 아래부터 `cells` 배열의 첫 원소(`key: 'collect'` 객체)까지를 다음으로 바꾼다:

```tsx
  const quarantine = useQuarantineSummary();
  const mismatch = useMismatchSummary();

  const stages = summary.data?.stages ?? [];
  const hasSummary = summary.data !== undefined;
  const collect = collectCell(known(quarantine), known(mismatch));
  const cells: BandCell[] = [
    collect.cell,
```

(지워지는 것: `qCount` 상수와 `key: 'collect'` 객체 리터럴. `...BOARD_STAGES.slice(1, 9)` 이하는 그대로.)

`selected === 'collect'` 분기의 `<Link …>수집 격리 목록으로</Link>` 를 다음으로 바꾼다:

```tsx
      {selected === 'collect' ? (
        <div className="flex flex-wrap gap-2 rounded-lg border bg-white px-4 py-6 text-sm">
          {collect.links.length === 0 ? (
            <span className="text-muted-foreground">없음</span>
          ) : (
            collect.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md border px-3 py-2 hover:border-slate-400"
              >
                {link.label}
                {link.count !== null && (
                  <b className="ml-1.5 tabular-nums">
                    {link.count.toLocaleString('ko-KR')}
                  </b>
                )}
              </Link>
            ))
          )}
        </div>
      ) : (
```

- [ ] **Step 5: 타입·린트·스펙**

```bash
(cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -c 'error TS')   # 기준선 그대로
npx eslint apps/admin-web/src/features/order/stall-board/template/index.tsx apps/admin-web/src/features/order/stall-board/collect-cell.ts
npx jest apps/admin-web/src/features/order/stall-board
```

Expected: 기준선 그대로 · eslint 0 problems · PASS. `cellCount` import 가 아직 쓰이는지 확인(1~8단계가 쓴다 — 지우지 않는다).

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/order/stall-board
git commit -m "feat(admin-web): 정체 보드 수집 칸에 채널과 어긋남을 합친다 (#1016 45번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 3: «채널과 어긋남» 표시 규칙

**Files:**
- Create: `apps/admin-web/src/features/order/channel-mismatches/display.ts`
- Create: `apps/admin-web/src/features/order/channel-mismatches/display.spec.ts`

**Interfaces:**
- Consumes: `ReconcileFindingDto`·`FindingKind`·`HumanReason`(Task 1), `formatDwell`(`@/lib/utils/format-dwell`), `actionErrorText`·`loadErrorText`(기존 `@/features/events/failures/display` — 409 문구·504 처리를 같은 규칙으로 쓴다)
- Produces: `MEMO_MAX = 500`, `orderNoOf(f): string`, `kindLabel(kind: string): string`, `handlingText(f): string`, `lastResultText(result: string | null): string`, `firstSeenText(iso: string, now: Date): string`, `canAct(f): boolean`, `redeliverOutcome(result: string): { tone: 'success' | 'error'; text: string }`, `memoError(memo: string): string | null`, `emptyText(scope: MismatchListScope): string`, 재수출 `actionErrorText`·`loadErrorText`

- [ ] **Step 1: 스펙(실패)**

`apps/admin-web/src/features/order/channel-mismatches/display.spec.ts`:

```ts
import type { ReconcileFindingDto } from '@/lib/api/domains/channel/order-reconcile-findings.shape';
import {
  MEMO_MAX,
  actionErrorText,
  canAct,
  emptyText,
  firstSeenText,
  handlingText,
  kindLabel,
  lastResultText,
  memoError,
  orderNoOf,
  redeliverOutcome,
} from './display';

const base: ReconcileFindingDto = {
  id: 'f1',
  channel: 'medusa',
  externalOrderId: 'order_01',
  displayOrderNo: '1042',
  kind: 'missing_order',
  status: 'open',
  handling: 'human',
  humanReason: 'out_of_window',
  coreStatus: null,
  channelCreatedAt: '2026-10-01T00:00:00.000Z',
  mode: 'observe',
  lastResult: 'skipped',
  attemptCount: 0,
  firstSeenAt: '2026-10-16T09:30:00.000Z',
  lastSeenAt: '2026-10-16T10:00:00.000Z',
  lastAttemptAt: null,
  resolvedAt: null,
  closedAt: null,
  closedBy: null,
  closeMemo: null,
};

describe('주문번호·종류', () => {
  it('표시 번호가 없으면 채널 주문 id', () => {
    expect(orderNoOf(base)).toBe('1042');
    expect(orderNoOf({ ...base, displayOrderNo: null })).toBe('order_01');
  });
  it('두 종류의 한국어 이름, 모르는 값은 그대로', () => {
    expect(kindLabel('missing_order')).toBe('core 에 없음');
    expect(kindLabel('cancel_not_applied')).toBe('취소 미반영');
    expect(kindLabel('something_new')).toBe('something_new');
  });
});

describe('handlingText — 처리 칸', () => {
  it('자동', () => {
    expect(handlingText({ ...base, handling: 'auto', humanReason: null })).toBe('자동');
  });
  it('사람 — 사유 넷', () => {
    expect(handlingText(base)).toBe('사람 — 3일 지난 주문');
    expect(handlingText({ ...base, humanReason: 'event_failure_open' })).toBe('사람 — 이벤트 실패 열림');
    expect(handlingText({ ...base, humanReason: 'attempts_exhausted' })).toBe('사람 — 시도 3회 소진');
  });
  it('core 상태 사유엔 그 상태를 붙인다 — 출고됨인지 보고 종결을 판단한다', () => {
    expect(handlingText({ ...base, kind: 'cancel_not_applied', humanReason: 'core_status', coreStatus: 'shipped' })).toBe(
      '사람 — core 가 취소를 못 받음 (shipped)'
    );
  });
  it('해소·종결 행은 상태가 처리 칸을 대신한다', () => {
    expect(handlingText({ ...base, status: 'resolved' })).toBe('해소');
    expect(handlingText({ ...base, status: 'closed', closeMemo: '셀메이트로 나감' })).toBe('종결 — 셀메이트로 나감');
    expect(handlingText({ ...base, status: 'closed' })).toBe('종결');
  });
});

describe('lastResultText — 마지막 결과', () => {
  it('관찰 모드와 자동 경로의 값', () => {
    expect(lastResultText('would_act')).toBe('관찰 — 보내지 않음');
    expect(lastResultText('skipped')).toBe('건너뜀');
    expect(lastResultText('enqueued')).toBe('보냄');
  });
  it('다시 배달의 결과 어휘', () => {
    expect(lastResultText('created')).toBe('수집함');
    expect(lastResultText('not_found')).toBe('채널에 없음');
    expect(lastResultText('nothing_to_send')).toBe('보낼 취소 없음');
    expect(lastResultText('no_mapping')).toBe('매핑 없음');
  });
  it('오류는 접두사를 바꿔 보인다', () => {
    expect(lastResultText('error: core lookup 503')).toBe('오류 — core lookup 503');
  });
  it('없으면 -, 모르는 값은 그대로', () => {
    expect(lastResultText(null)).toBe('-');
    expect(lastResultText('brand_new')).toBe('brand_new');
  });
});

describe('canAct — 조치 버튼은 열린 사람 행에만 (스펙 §8.2)', () => {
  it.each([
    [{ status: 'open', handling: 'human' }, true],
    [{ status: 'open', handling: 'auto' }, false],
    [{ status: 'resolved', handling: 'human' }, false],
    [{ status: 'closed', handling: 'human' }, false],
  ] as const)('%o → %s', (patch, expected) => {
    expect(canAct({ ...base, ...patch })).toBe(expected);
  });
});

describe('redeliverOutcome — 다시 배달 결과 토스트', () => {
  it('보냈거나 수집했으면 성공', () => {
    expect(redeliverOutcome('enqueued')).toEqual({ tone: 'success', text: '보냈습니다' });
    expect(redeliverOutcome('emitted')).toEqual({ tone: 'success', text: '보냈습니다' });
    expect(redeliverOutcome('created')).toEqual({ tone: 'success', text: '수집했습니다' });
  });
  it('200 이어도 아무것도 안 보냈으면 오류 톤 — 성공으로 보이면 운영자가 떠난다', () => {
    expect(redeliverOutcome('not_found')).toEqual({ tone: 'error', text: '보내지 않음 — 채널에 없음' });
    expect(redeliverOutcome('unchanged')).toEqual({ tone: 'error', text: '보내지 않음 — 변경 없음' });
    expect(redeliverOutcome('nothing_to_send').tone).toBe('error');
  });
});

describe('memoError — 종결 메모', () => {
  it('비었거나 공백뿐이면 오류', () => {
    expect(memoError('')).toBe('메모를 입력하세요');
    expect(memoError('   ')).toBe('메모를 입력하세요');
  });
  it('500자까지', () => {
    expect(MEMO_MAX).toBe(500);
    expect(memoError('a'.repeat(500))).toBeNull();
    expect(memoError('a'.repeat(501))).toBe('500자 이내로 입력하세요');
  });
});

describe('그 밖', () => {
  it('첫 발견은 지난 시간', () => {
    expect(firstSeenText('2026-10-16T09:30:00.000Z', new Date('2026-10-16T11:30:00.000Z'))).toBe('2시간 전');
    // 시계가 어긋나 미래 시각이면 0분
    expect(firstSeenText('2026-10-16T12:00:00.000Z', new Date('2026-10-16T11:30:00.000Z'))).toBe('0분 전');
  });
  it('빈 목록 문구', () => {
    expect(emptyText('open')).toBe('어긋난 주문 없음');
    expect(emptyText('all')).toBe('기록 없음');
  });
  it('409 문구는 그대로, 504 는 «처리 중»', () => {
    const conflict = Object.assign(new Error('이미 core 에 반영돼 있다 — 다음 대사 주기에 해소로 닫힌다'), { statusCode: 409 });
    expect(actionErrorText(conflict)).toBe('이미 core 에 반영돼 있다 — 다음 대사 주기에 해소로 닫힌다');
    const timeout = Object.assign(new Error('timeout'), { statusCode: 504 });
    expect(actionErrorText(timeout)).toBe('서버에서 계속 처리 중입니다 — 잠시 뒤 새로 읽으세요');
  });
});
```

Run: `npx jest apps/admin-web/src/features/order/channel-mismatches/display.spec.ts`
Expected: FAIL — `Cannot find module './display'`

- [ ] **Step 2: 구현**

`apps/admin-web/src/features/order/channel-mismatches/display.ts`:

```ts
// «채널과 어긋남» 목록의 표시 규칙 (#1016 45번 스펙 §8.2). React·axios·react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능하므로 화면 문장·버튼 노출은 전부 여기서 만들고 여기서 검증한다.

import { formatDwell } from '@/lib/utils/format-dwell';
import type {
  FindingKind,
  HumanReason,
  MismatchListScope,
  ReconcileFindingDto,
} from '@/lib/api/domains/channel/order-reconcile-findings.shape';

// 409 문구 그대로·504 는 «처리 중» — 이벤트 실패 화면과 같은 규칙이다
export { actionErrorText, loadErrorText } from '@/features/events/failures/display';

/** 서버 `CloseFindingDto` 의 `@MaxLength(500)` 과 같다 */
export const MEMO_MAX = 500;

const KIND_LABELS: Record<FindingKind, string> = {
  missing_order: 'core 에 없음',
  cancel_not_applied: '취소 미반영',
};

const HUMAN_REASON_LABELS: Record<HumanReason, string> = {
  out_of_window: '3일 지난 주문',
  core_status: 'core 가 취소를 못 받음',
  event_failure_open: '이벤트 실패 열림',
  attempts_exhausted: '시도 3회 소진',
};

// 어댑터가 `last_result` 에 쓰는 값: 대사 주기(would_act·pending·skipped), 적재(enqueued),
// 다시 배달 결과(`RedeliveryResult` = `OrderSyncOutcome` + no_mapping·nothing_to_send), 오류(`error: …`)
const RESULT_LABELS: Record<string, string> = {
  would_act: '관찰 — 보내지 않음',
  pending: '보낼 차례',
  skipped: '건너뜀',
  enqueued: '보냄',
  emitted: '보냄',
  created: '수집함',
  unchanged: '변경 없음',
  not_found: '채널에 없음',
  not_eligible: '수집 대상 아님',
  identification_failed: '식별 실패',
  channel_inactive: '채널 비활성',
  no_mapping: '매핑 없음',
  nothing_to_send: '보낼 취소 없음',
};

const ERROR_PREFIX = 'error: ';

function labelOf(labels: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key;
}

export function orderNoOf(f: ReconcileFindingDto): string {
  return f.displayOrderNo || f.externalOrderId;
}

export function kindLabel(kind: string): string {
  return labelOf(KIND_LABELS, kind);
}

export function handlingText(f: ReconcileFindingDto): string {
  if (f.status === 'resolved') return '해소';
  if (f.status === 'closed') return f.closeMemo ? `종결 — ${f.closeMemo}` : '종결';
  if (f.handling === 'auto') return '자동';
  const reason = f.humanReason ? labelOf(HUMAN_REASON_LABELS, f.humanReason) : '';
  const status = f.humanReason === 'core_status' && f.coreStatus ? ` (${f.coreStatus})` : '';
  return reason ? `사람 — ${reason}${status}` : '사람';
}

export function lastResultText(result: string | null): string {
  if (!result) return '-';
  if (result.startsWith(ERROR_PREFIX)) return `오류 — ${result.slice(ERROR_PREFIX.length)}`;
  return labelOf(RESULT_LABELS, result);
}

export function firstSeenText(iso: string, now: Date): string {
  return `${formatDwell(Math.max(0, now.getTime() - new Date(iso).getTime()))} 전`;
}

/** 조치는 열린 사람 행에만(스펙 §8.2). 자동 행은 대사가 다음 주기에 스스로 다룬다 */
export function canAct(f: ReconcileFindingDto): boolean {
  return f.status === 'open' && f.handling === 'human';
}

const SENT = new Set(['enqueued', 'emitted']);

/** 200 이어도 보낸 게 아니면 오류 톤이다 — 성공으로 보이면 운영자가 «보냈다»고 믿고 떠난다 */
export function redeliverOutcome(result: string): { tone: 'success' | 'error'; text: string } {
  if (SENT.has(result)) return { tone: 'success', text: '보냈습니다' };
  if (result === 'created') return { tone: 'success', text: '수집했습니다' };
  return { tone: 'error', text: `보내지 않음 — ${lastResultText(result)}` };
}

export function memoError(memo: string): string | null {
  const trimmed = memo.trim();
  if (!trimmed) return '메모를 입력하세요';
  if (trimmed.length > MEMO_MAX) return `${MEMO_MAX}자 이내로 입력하세요`;
  return null;
}

export function emptyText(scope: MismatchListScope): string {
  return scope === 'open' ? '어긋난 주문 없음' : '기록 없음';
}
```

- [ ] **Step 3: 통과 확인**

Run: `npx jest apps/admin-web/src/features/order/channel-mismatches/display.spec.ts`
Expected: PASS. `actionErrorText` 를 재수출로 가져오므로 `features/events/failures/display.ts` 가 값 import 하는 것(`@/lib/utils/format-dwell` 뿐)이 함께 로드된다 — app 전용 의존성 없음. Task 1 Step 10 의 CI 조건 명령을 이 스펙에도 한 번 돌린다.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/order/channel-mismatches/display.ts apps/admin-web/src/features/order/channel-mismatches/display.spec.ts
git commit -m "feat(admin-web): 채널과 어긋남 표시 규칙 (#1016 45번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 4: «채널과 어긋남» 목록 화면

**Files:**
- Create: `apps/admin-web/src/features/order/channel-mismatches/components/close-dialog.tsx`
- Create: `apps/admin-web/src/features/order/channel-mismatches/template/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/order/channel-mismatches/page.tsx`
- Modify: `apps/admin-web/src/components/common/breadcrumb-items.ts:64-84` (`/order/` 분기)
- Modify: `apps/admin-web/src/components/common/breadcrumb-items.spec.ts`

**Interfaces:**
- Consumes: `useMismatches(scope)`·`useRedeliverMismatch()`·`useCloseMismatch()`(Task 1), `MismatchListScope`·`ReconcileFindingDto`(Task 1), Task 3 의 표시 함수 전부, `MISMATCH_LIST_PATH`(Task 2 — 경로 문자열이 보드 링크와 같아야 한다)
- Produces: 라우트 `/order/channel-mismatches`(admin·master)

- [ ] **Step 1: 빵부스러기 스펙(실패)**

`apps/admin-web/src/components/common/breadcrumb-items.spec.ts` 의 `describe('admin breadcrumb items', …)` 안에 더한다:

```ts
  it('labels the channel mismatch list under order management', () => {
    expect(
      getBreadcrumbItems('/order/channel-mismatches').map((item) => item.label)
    ).toEqual(['홈', '주문/출고관리', '채널과 어긋남']);
  });
```

Run: `npx jest apps/admin-web/src/components/common/breadcrumb-items.spec.ts`
Expected: FAIL — `['홈', '주문/출고관리']` 만 나온다.

- [ ] **Step 2: 빵부스러기 구현**

`apps/admin-web/src/components/common/breadcrumb-items.ts` 의 `/order/` 분기 마지막 `else if (pathname.includes('/inspection')) { … }` 뒤에 이어 붙인다:

```ts
    } else if (pathname.includes('/channel-mismatches')) {
      items.push({ label: '채널과 어긋남' });
```

(즉 `} else if (pathname.includes('/inspection')) { items.push({ label: '검수발송' }); }` 의 닫는 `}` 앞에 위 두 줄이 들어가 체인이 한 칸 늘어난다.)

Run: `npx jest apps/admin-web/src/components/common/breadcrumb-items.spec.ts`
Expected: PASS

- [ ] **Step 3: 종결 대화상자**

`apps/admin-web/src/features/order/channel-mismatches/components/close-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MEMO_MAX, memoError } from '../display';

export interface CloseTarget {
  id: string;
  /** 무엇을 종결하는지 한 줄 — 주문번호 · 종류 */
  label: string;
}

interface CloseDialogProps {
  target: CloseTarget | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (memo: string) => void;
}

export function CloseDialog({ target, pending, onClose, onSubmit }: CloseDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* key 로 대상이 바뀔 때마다 입력을 비운다 */}
        {target && (
          <CloseForm
            key={target.id}
            target={target}
            pending={pending}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloseForm({
  target,
  pending,
  onClose,
  onSubmit,
}: {
  target: CloseTarget;
  pending: boolean;
  onClose: () => void;
  onSubmit: (memo: string) => void;
}) {
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);
  const error = memoError(memo);

  return (
    <>
      <DialogHeader>
        <DialogTitle>종결</DialogTitle>
        <DialogDescription>{target.label}</DialogDescription>
      </DialogHeader>
      <Textarea
        value={memo}
        maxLength={MEMO_MAX}
        placeholder="메모"
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => setTouched(true)}
        autoFocus
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="text-red-600">{touched ? error : null}</span>
        <span>
          {memo.length}/{MEMO_MAX}
        </span>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button
          variant="destructive"
          disabled={error !== null || pending}
          onClick={() => onSubmit(memo.trim())}
        >
          종결
        </Button>
      </DialogFooter>
    </>
  );
}
```

- [ ] **Step 4: 목록 템플릿**

먼저 토글 컴포넌트의 export 이름을 확인한다: `grep -n "export" apps/admin-web/src/components/ui/switch.tsx` → `Switch` 여야 한다(다르면 그 이름으로 바꾼다).

`apps/admin-web/src/features/order/channel-mismatches/template/index.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { MismatchListScope } from '@/lib/api/domains/channel/order-reconcile-findings.shape';
import { useMismatches } from '@/lib/services/channel/queries';
import { useCloseMismatch, useRedeliverMismatch } from '@/lib/services/channel/mutations';
import {
  actionErrorText,
  canAct,
  emptyText,
  firstSeenText,
  handlingText,
  kindLabel,
  lastResultText,
  loadErrorText,
  orderNoOf,
  redeliverOutcome,
} from '../display';
import { CloseDialog, type CloseTarget } from '../components/close-dialog';

export default function ChannelMismatchesTemplate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [scope, setScope] = useState<MismatchListScope>('open');
  const list = useMismatches(scope);
  const redeliver = useRedeliverMismatch();
  const close = useCloseMismatch();
  const [closeTarget, setCloseTarget] = useState<CloseTarget | null>(null);

  const rows = list.data?.data ?? [];

  // 결과 토스트는 mutateAsync 의 promise 에 건다 — mutate() 쪽 콜백은 다음 호출·언마운트로 유실된다
  const onRedeliver = (id: string) =>
    redeliver.mutateAsync(id).then(
      (result) => {
        const outcome = redeliverOutcome(result);
        if (outcome.tone === 'success') toast.success(outcome.text);
        else toast.error(outcome.text);
      },
      (e) => toast.error(actionErrorText(e))
    );

  const onClose = (memo: string) => {
    if (!closeTarget) return;
    void close.mutateAsync({ id: closeTarget.id, memo }).then(
      () => {
        setCloseTarget(null);
        toast.success('종결');
      },
      (e) => toast.error(actionErrorText(e))
    );
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">채널과 어긋남</h1>
        <label className="flex items-center gap-2 text-sm">
          해소·종결 보기
          <Switch
            checked={scope === 'all'}
            onCheckedChange={(on) => setScope(on ? 'all' : 'open')}
          />
        </label>
      </div>

      {list.isError ? (
        <p className="text-sm text-red-600">{loadErrorText(list.error)}</p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText(scope)}</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-40" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-14" />
            <col />
            <col className="w-56" />
            <col className="w-44" />
          </colgroup>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">주문번호</th>
              <th>종류</th>
              <th>첫 발견</th>
              <th>시도</th>
              <th>처리</th>
              <th>마지막 결과</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t">
                <td className="truncate py-1.5 font-mono text-xs" title={f.externalOrderId}>
                  {orderNoOf(f)}
                </td>
                <td>{kindLabel(f.kind)}</td>
                <td title={new Date(f.firstSeenAt).toLocaleString('ko-KR')}>
                  {firstSeenText(f.firstSeenAt, now)}
                </td>
                <td className="tabular-nums">{f.attemptCount || ''}</td>
                <td className="truncate" title={handlingText(f)}>
                  {handlingText(f)}
                </td>
                <td className="truncate" title={f.lastResult ?? undefined}>
                  {lastResultText(f.lastResult)}
                </td>
                <td className="text-right">
                  {canAct(f) && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={redeliver.isPending && redeliver.variables === f.id}
                        onClick={() => void onRedeliver(f.id)}
                      >
                        다시 배달
                      </Button>{' '}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setCloseTarget({
                            id: f.id,
                            label: `${orderNoOf(f)} · ${kindLabel(f.kind)}`,
                          })
                        }
                      >
                        종결
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {list.data?.truncated && (
        <p className="text-xs text-muted-foreground">앞 {rows.length}건만 보입니다</p>
      )}

      <CloseDialog
        target={closeTarget}
        pending={close.isPending}
        onClose={() => setCloseTarget(null)}
        onSubmit={onClose}
      />
    </div>
  );
}
```

- [ ] **Step 5: 라우트**

`apps/admin-web/src/app/(admin)/order/channel-mismatches/page.tsx`:

```tsx
// src/app/(admin)/order/channel-mismatches/page.tsx
// 메뉴에 없다 — 정체 보드 0단계에서만 들어온다(#1016 45번 스펙 §8.2)

import RouteGuard from '@/components/layout/route-guard';
import ChannelMismatchesTemplate from '@/features/order/channel-mismatches/template';

export default function ChannelMismatchesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <ChannelMismatchesTemplate />
    </RouteGuard>
  );
}
```

경로가 보드 링크와 같은지 확인: `grep -rn "channel-mismatches" apps/admin-web/src --include=*.ts --include=*.tsx` → `collect-cell.ts` 의 `MISMATCH_LIST_PATH` 와 이 디렉터리 이름이 같아야 한다.

- [ ] **Step 6: 타입·린트·스펙**

```bash
(cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -c 'error TS')   # 기준선 그대로
npx eslint apps/admin-web/src/features/order/channel-mismatches apps/admin-web/src/app/\(admin\)/order/channel-mismatches/page.tsx apps/admin-web/src/components/common/breadcrumb-items.ts
npx jest apps/admin-web/src/components/common apps/admin-web/src/features/order
```

Expected: 기준선 그대로 · eslint 0 problems · PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/order/channel-mismatches apps/admin-web/src/app/\(admin\)/order/channel-mismatches apps/admin-web/src/components/common/breadcrumb-items.ts apps/admin-web/src/components/common/breadcrumb-items.spec.ts
git commit -m "feat(admin-web): 채널과 어긋남 목록 — 다시 배달·종결 (#1016 45번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 5: 전체 게이트 · 로컬 E2E · PR · 트래킹

**Files:** 코드 변경 없음(E2E 로 고칠 게 나오면 해당 태스크 파일).

- [ ] **Step 1: 전체 게이트**

```bash
(cd apps/admin-web && npx tsc --noEmit 2>&1 | grep -c 'error TS')   # Task 1 Step 0 기준선과 같다
npm run type-check                                                 # 0 (admin-web 은 안 보지만 회귀 확인)
npx jest --maxWorkers=2                                            # 실패 0
npm run test:admin-web                                             # 실패 0
```

결과 숫자(스위트·테스트 수)를 PR 본문에 그대로 옮긴다. 실패가 develop 에서도 나는지 보려면 `gh run list --workflow verification-gates.yml --branch develop --limit 3`.

- [ ] **Step 2: 로컬 E2E (브라우저 로그인은 사용자가 한다)**

```bash
npm run bootstrap:e2e:local
npm run start:all:local          # 백그라운드. admin-web 은 :8002
npm run preflight:e2e:local
```

어댑터 로컬 DB 에 사람 행 하나를 넣는다(로컬 전용, `id` 는 앱이 만드는 칸이라 직접 준다):

```bash
psql "$(grep '^DATABASE_URL=' apps/channel-adapter/.env | cut -d= -f2- | tr -d '"')" -c "
insert into order_reconcile_findings (id, channel, external_order_id, display_order_no, kind, status, handling, human_reason, channel_created_at, mode, last_result)
values (gen_random_uuid(), 'medusa', 'order_e2e_mismatch', '9001', 'missing_order', 'open', 'human', 'out_of_window', now() - interval '10 days', 'observe', 'skipped');"
```

사용자에게 `http://localhost:8002` 로그인을 부탁한 뒤 확인한다:

1. `/order/stall-board` — 0단계 칸 숫자가 «격리 + 1», 빨간 갇힘 줄이 1 늘었다. 칸을 누르면 «채널과 어긋남 1» 링크가 보이고, 격리가 0 이면 «수집 격리» 링크는 없다.
2. 링크 → `/order/channel-mismatches` — 행 하나: `9001 · core 에 없음 · n분 전 · (시도 빈칸) · 사람 — 3일 지난 주문 · 건너뜀 · [다시 배달][종결]`. 빵부스러기 «주문/출고관리 › 채널과 어긋남».
3. [다시 배달] — 가짜 주문이라 서버가 `syncOrder` → `not_found` 를 돌려줄 것이다: 오류 톤 토스트 «보내지 않음 — 채널에 없음», 표가 갱신돼 시도 1·마지막 결과 «채널에 없음».
4. [종결] — 빈 메모로는 버튼이 꺼져 있다. «E2E» 입력 → 종결 → 행이 사라지고 «어긋난 주문 없음». 토글 켜면 «종결 — E2E».
5. 요약 실패 확인: channel-adapter 를 잠깐 내리고(`start-all` 의 해당 pid kill) 보드를 새로 읽으면 0단계 칸이 `—`, 칸을 누르면 두 링크가 건수 없이 보인다. 다시 띄운다.

뒷정리:

```bash
psql "$(grep '^DATABASE_URL=' apps/channel-adapter/.env | cut -d= -f2- | tr -d '"')" -c "delete from order_reconcile_findings where external_order_id = 'order_e2e_mismatch';"
```

본 결과(번호별 통과/실패, 다르게 나온 문구)를 PR 본문에 적는다. 3번이 `not_found` 가 아닌 다른 결과면 그 결과 문자열을 그대로 적는다(서버 어휘가 Task 3 표에 없으면 표에 더한다).

- [ ] **Step 3: PR**

```bash
git push -u origin feat/1016-45-channel-mismatch-screen
gh pr create --base develop --title "feat(admin-web): 정체 보드 수집 칸 합치기·채널과 어긋남 목록 (#1016 45번, PR 2 화면)" --body-file <스크래치 파일>
```

본문에:
- 스펙 §8·이 계획 경로, PR 1 #1084
- 바뀐 것 셋: 0단계 칸 합산, 링크 둘(0 이면 숨김), `/order/channel-mismatches`(메뉴 없음)
- 게이트 숫자(Step 1), E2E 결과(Step 2)
- 배포: admin-web 만 바뀌고 마이그 없음. 아래 Step 5 의 명령
- 끝줄 `https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`

- [ ] **Step 4: #1016 본문 (머지 뒤, 코멘트 금지)**

`gh issue view 1016 --json body -q .body > <스크래치>/1016.md` 로 받아 고친 뒤 `gh issue edit 1016 --body-file <스크래치>/1016.md`:
- 45번 «해결» 칸: PR 1 머지 커밋 `825b10a62` + 이 PR 의 머지 커밋
- 45번 «문서» 칸: 이 계획 경로를 더한다
- 그 뒤 «주문의 일생» 아티팩트 동기화(메모리 `order-lifecycle-audit-2026-10-05` 의 절차)

- [ ] **Step 5: 배포 명령 (사용자가 실행 — 에이전트는 안내만)**

admin-web 만 바뀌었지만 `--target AdminWeb` 은 이 저장소에서 못 쓴다(대상 아닌 Next 앱의 로컬 프로덕션 빌드가 없으면 죽는다). 그래서 전체 배포이고, **develop 에 머지돼 아직 라이브에 없는 다른 PR 의 마이그도 같이 실린다.** 배포 전에 그것부터 본다:

```bash
git fetch origin && git checkout develop && git pull
# 라이브 배포 이후 develop 에 들어온 마이그(있으면 배포 전에 db:migrate 가 먼저다 — migrate → deploy)
git diff --name-only 825b10a62..origin/develop -- 'apps/*/drizzle/*.sql'
# Next 앱 셋은 로컬 node_modules 로 배포 빌드된다 — 세 트리 모두(루트 npm ci 는 admin-web·storefront 를 안 깐다)
npm ci && npm ci --prefix apps/admin-web && npm ci --prefix web/almondyoung-storefront
npx sst deploy --stage live
```

마이그가 나오면 그 서비스의 deployment 로 먼저: `npm run db:migrate -- --stage live --deployment <lcnine-services|lcnine-auth> --yes`. 배포 뒤 라이브 admin-web 에서 `/order/stall-board` 0단계 칸이 숫자(또는 0)로 뜨고 `—` 가 아닌지, `/order/channel-mismatches` 가 «어긋난 주문 없음»(10-16 첫 대사 불일치 0)으로 열리는지 본다.
