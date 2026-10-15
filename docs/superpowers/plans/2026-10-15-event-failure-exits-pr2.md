# 이벤트 실패 출구 PR 2 (admin-web 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core·channel-adapter 의 컨슈머 실패(«받다 실패»)와 outbox `FAILED`(«보내다 실패»)를 admin-web 한 화면에서 보고, 다시 넣고(보내고), 사유를 적어 종결한다 (#1016 7·8번).

**Architecture:** PR 1(#1081, `2b7b9e9bd`)의 두 API(core `/event-failures`, channel-adapter `/adapter/event-failures`)는 모양이 같다 — 클라이언트 하나가 서비스 이름으로 접두사만 바꾼다. 화면은 `/events/failures` 한 페이지, 서비스 탭 둘, 탭 안에 목록 둘. 표시 규칙은 `.ts` 순수 함수(`display.ts`)로 두고 그것만 테스트한다(admin-web 은 컴포넌트 테스트 불가).

**Tech Stack:** Next.js(app router) · React · @tanstack/react-query v5 · axios(`lib/api/client.ts`) · shadcn(`Dialog`·`AlertDialog`·`Tabs`·`Textarea`·`Button`) · sonner 토스트 · Jest(`npm run test:admin-web`)

**Spec:** `docs/superpowers/specs/2026-10-15-event-failure-exits-design.md` §10(+ §9 API, §7·§8 동작). 스펙 머리의 «계획·구현 단계 결정» 블록이 원문보다 우선한다.

## 스펙과 달라진 점 (PR 2 계획 단계 결정, 사용자 결정 2026-10-15)

| 스펙 | 계획 | 이유 |
| --- | --- | --- |
| §10 경로 `/system/event-failures`, 사이드바 «시스템» 그룹 | 경로 `/events/failures`, 메뉴 «주문/출고관리 › 정체 보드» 바로 아래 «이벤트 실패» | «시스템» 그룹은 없다. 기존 `/events/trace` 와 같은 `(admin)/events` 아래에 두고, 실패가 주문 경로 양 끝(core·channel-adapter)의 것이라 정체 보드를 보는 사람이 같은 자리에서 본다 |
| §10 확인 UX 미정 | 단건 다시 넣기·다시 보내기는 확인 없이 바로(한 번만 시도라 안전), 종결은 사유 대화상자(필수·500자) + «뒤 N건이 이어서 처리됩니다», 전체 다시 넣기·보내기는 건수를 보여 주는 확인 대화상자. 결과는 토스트 한 문장 | 사용자 선택 |
| §9 `GET dead-letters?topic` | 토픽 거르기 UI 를 두지 않는다 | §10 이 요구하지 않는다(YAGNI). API 는 그대로 |

## Global Constraints

- 프록시: core 는 `ALMONDYOUNG_API_BASE_URL`(브라우저 `/proxy/api`), channel-adapter 는 `CHANNEL_ADAPTER_SERVICE_BASE_URL`(브라우저 `/proxy/channel`). 둘 다 `@/const` 에서 가져온다. axios `baseURL` 이 `/api` 라 실제 요청은 `/api/proxy/…`
- 라우트 접두사: core `/event-failures`, channel-adapter `/adapter/event-failures` (PR 1 컨트롤러)
- 두 백엔드는 응답을 envelope 로 감싸지 않는다 — 클라이언트에서 `.data.data` 로 벗기지 말 것(`order-collection-failures.client.ts` 머리 주석의 #640 회귀)
- 종결 사유: 앞뒤 공백을 뗀 뒤 비면 거부, 최대 500자 (`DiscardFailureDto` `@MaxLength(500)`)
- 페이지·메뉴 권한: `admin`·`master` (`RouteGuard requireRole={['admin', 'master']}`, 메뉴 `requireRole`)
- 화면 글씨 최소. 실패 0건이면 목록 자리에 «실패 없음» 한 줄
- 표시 규칙(체류 표기·오류 한 줄·결과 요약 문장·확인 문구·사유 검증·탭 배지)은 `features/events/failures/display.ts` 의 순수 함수. React·axios·react-query 를 import 하지 않는다
- 체류 표기는 기존 `formatDwell`(`lib/utils/format-dwell.ts`)을 쓴다 — 정체 보드와 같은 표기
- 쿼리 키는 `undefined` 를 섞지 않는다(무효화가 조용히 빗나간다). 모든 실패 쿼리는 `['events', 'failures', service]` 아래에 둔다
- 게이트: admin-web `npx tsc --noEmit` 0 · `npm run test:admin-web` 실패 0 · 루트 `npx jest --maxWorkers=2` 실패 0

## Review Focus

1. **마이그 전 배포 상태** — 요약 API 가 500, 다시 넣기가 «컨슈머가 시작되지 않았다 / 마이그 필요» 오류를 낸다. 그 탭은 빨간 한 줄로 보이고 **다른 탭은 정상 동작**해야 한다. 쿼리 재시도가 겹쳐 오류가 늦게 뜨지 않게 `retry: false` → Task 2 `loadErrorText` 테스트 + Task 3 쿼리 옵션
2. **머리 아닌 `held` 종결** — 상세의 순서 목록에서 머리 아닌 행을 종결하면 아무것도 흐르지 않는다. 그 대화상자에 «뒤 N건이 이어서…»가 뜨면 거짓말이다 → Task 2 `discardFollowUpText(0)` 이 `null`, Task 4 가 머리 아닌 행엔 0 을 넘긴다
3. **멈춘 결과를 성공처럼 보이기** — 다시 넣기가 중간에 멈추면(`stoppedAt`) 처리 건수만 보여 주면 성공으로 읽힌다 → Task 2 `redriveResultText`·`discardResultText`·`isStopped` 테스트
4. **409 «이미 진행 중»·«이미 처리된 행»** — 두 사람이 같은 순서를 누르면 서버가 409. 오류 토스트로 서버 문구를 보여 주고 목록을 새로 읽어야 한다 → Task 3 뮤테이션이 `onSettled` 에서 무효화
5. **오류 메시지 여러 줄·긴 스택** — 목록 칸이 넘쳐 표가 깨지면 안 된다 → Task 2 `errorOneLine` 의 첫 줄·자르기 테스트

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| Create `apps/admin-web/src/lib/api/domains/events/failures.types.ts` | 서비스 이름·응답 타입(PR 1 응답의 JSON 직렬화 모양 — 날짜는 문자열) |
| Create `apps/admin-web/src/lib/api/domains/events/failures.client.ts` | 서비스별 접두사로 11개 엔드포인트 호출 |
| Modify `apps/admin-web/src/lib/api/domains/events/index.ts` | export 추가 |
| Create `apps/admin-web/src/features/events/failures/display.ts` | 표시 규칙 순수 함수 |
| Create `apps/admin-web/src/features/events/failures/display.spec.ts` | 위 테스트 |
| Modify `apps/admin-web/src/lib/services/events/query-keys.ts` | 실패 쿼리 키 |
| Create `apps/admin-web/src/lib/services/events/failures.queries.ts` | 요약·목록(무한)·상세 쿼리 |
| Create `apps/admin-web/src/lib/services/events/failures.mutations.ts` | 다시 넣기·종결·전체 — 끝나면 그 서비스 쿼리 전부 무효화 |
| Modify `apps/admin-web/src/lib/services/events/index.ts` | export 추가 |
| Create `apps/admin-web/src/features/events/failures/components/discard-dialog.tsx` | 종결 사유 대화상자(두 목록 공용) |
| Create `apps/admin-web/src/features/events/failures/components/confirm-all-dialog.tsx` | 전체 다시 넣기·보내기 확인 |
| Create `apps/admin-web/src/features/events/failures/components/detail-parts.tsx` | JSON 블록·조치 기록·상세 표의 공용 조각 |
| Create `apps/admin-web/src/features/events/failures/components/dead-letter-section.tsx` | «받다 실패» 목록 + 펼친 상세 |
| Create `apps/admin-web/src/features/events/failures/components/outbox-section.tsx` | «보내다 실패» 목록 + 펼친 상세 |
| Create `apps/admin-web/src/features/events/failures/template/index.tsx` | 서비스 탭 + 배지 |
| Create `apps/admin-web/src/app/(admin)/events/failures/page.tsx` | 라우트 + 권한 |
| Modify `apps/admin-web/src/lib/utils/menu.ts` | «이벤트 실패» 메뉴 |
| Modify `apps/admin-web/src/lib/utils/menu.spec.ts` | 메뉴 위치 테스트 |
| Modify `apps/admin-web/src/components/common/breadcrumb-items.ts` | 브레드크럼 |

---

### Task 1: 응답 타입과 API 클라이언트

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/events/failures.types.ts`
- Create: `apps/admin-web/src/lib/api/domains/events/failures.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/events/index.ts`

**Interfaces:**
- Consumes: PR 1 의 응답 — `libs/events/src/dead-letter/dead-letter.query.ts`(`EventFailuresSummary`·`DeadLetterSequenceItem`·`DeadLetterDetail`), `dead-letter.redriver.ts`(`RedriveResult`·`RedriveAllResult`), `outbox/outbox-failures.service.ts`(`OutboxFailedItem`·`OutboxFailureDetail`·resend 결과), `dead-letter.schema.ts`(`failure_actions` 칸)
- Produces: 타입 `EventFailureService`, `EVENT_FAILURE_SERVICES`, `EventFailuresSummary`, `CursorPage<T>`, `DeadLetterSequenceItem`, `DeadLetterRow`, `FailureActionRow`, `DeadLetterDetail`, `RedriveResult`, `RedriveAllResult`, `OutboxFailedItem`, `OutboxFailureDetail`, `ResendResult`, `ResendAllResult`; 값 `eventFailuresClient`

이 태스크는 런타임 로직이 없는 타입·호출 배선이라 테스트가 없다. 검증은 `tsc` 다.

- [ ] **Step 1: 타입 파일 작성**

`apps/admin-web/src/lib/api/domains/events/failures.types.ts`:

```ts
// 이벤트 실패 출구 응답 타입 (#1016 7·8번). 서버 정본은 PR 1 의 서비스들이다:
//   libs/events/src/dead-letter/dead-letter.query.ts   — summary·dead-letters 목록·상세
//   libs/events/src/dead-letter/dead-letter.redriver.ts — redrive·discard·redrive-all 결과
//   libs/events/src/outbox/outbox-failures.service.ts   — outbox 목록·상세·resend·discard·resend-all
// 서버의 Date 는 JSON 으로 오면서 ISO 문자열이 된다. 두 앱 모두 응답을 envelope 로 감싸지 않는다.

export type EventFailureService = 'core' | 'channel-adapter';
export const EVENT_FAILURE_SERVICES: readonly EventFailureService[] = ['core', 'channel-adapter'];

export interface EventFailuresSummary {
  deadLetters: { failed: number; held: number; oldestFailedAt: string | null };
  outbox: { failed: number; oldestFailedAt: string | null };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: number | null;
}

/** 순서 하나 = 머리 행 + 뒤에서 기다리는 같은 순서의 안 푼 행 수 */
export interface DeadLetterSequenceItem {
  id: number;
  topic: string;
  handler: string;
  eventType: string | null;
  sequenceKey: string | null;
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  firstFailedAt: string;
  redriveCount: number;
  heldBehind: number;
}

export interface DeadLetterRow {
  id: number;
  consumerGroup: string;
  handler: string;
  topic: string;
  sequenceKey: string | null;
  messageId: string;
  eventType: string | null;
  envelope: unknown;
  kafkaPartition: number;
  kafkaOffset: string;
  /** failed · held · redriven · discarded */
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  redriveCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  resolvedAt: string | null;
}

export interface FailureActionRow {
  id: number;
  /** dead_letter · outbox */
  targetKind: string;
  targetId: number;
  /** redrive · discard */
  action: string;
  /** succeeded · failed */
  outcome: string;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

export interface DeadLetterDetail {
  row: DeadLetterRow;
  /** 같은 순서의 행 전부(해결된 것 포함), id 순서 */
  sequence: DeadLetterRow[];
  actions: FailureActionRow[];
}

export interface RedriveStop {
  id: number;
  errorName: string | null;
  errorMessage: string | null;
}

/** 다시 넣기·종결 결과. 머리를 종결하면 뒤 보류가 이어서 다시 넣어진 결과다 */
export interface RedriveResult {
  processed: number;
  stoppedAt: RedriveStop | null;
}

export interface RedriveAllResult {
  sequences: number;
  succeeded: number;
  stopped: number;
  /** 다른 사람이 다시 넣는 중이라 건너뛴 순서 */
  busy: number;
  stoppedByError: Record<string, number>;
}

export interface OutboxFailedItem {
  id: number;
  topic: string;
  eventType: string;
  aggregateId: string;
  createdAt: string;
  failedAt: string | null;
  retryCount: number;
  errorMessage: string | null;
  /** 같은 (topic, aggregate_id) 뒤에서 기다리는 PENDING 수 */
  waitingBehind: number;
}

export interface OutboxFailureDetail extends OutboxFailedItem {
  status: string;
  payload: unknown;
  actions: FailureActionRow[];
}

export type ResendResult = { status: 'PUBLISHED' } | { status: 'FAILED'; error: string };

export interface ResendAllResult {
  total: number;
  published: number;
  failed: Array<{ id: number; error: string }>;
}
```

- [ ] **Step 2: 클라이언트 작성**

`apps/admin-web/src/lib/api/domains/events/failures.client.ts`:

```ts
'use client';

// 이벤트 실패 출구 API (#1016 7·8번). core 와 channel-adapter 의 라우트 모양이 같아 접두사만 다르다.
// 응답은 envelope 없이 오므로 `response.data` 가 곧 본문이다 — 한 번 더 벗기지 말 것(#640).

import { ALMONDYOUNG_API_BASE_URL, CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CursorPage,
  DeadLetterDetail,
  DeadLetterSequenceItem,
  EventFailureService,
  EventFailuresSummary,
  OutboxFailedItem,
  OutboxFailureDetail,
  RedriveAllResult,
  RedriveResult,
  ResendAllResult,
  ResendResult,
} from './failures.types';

const BASE: Record<EventFailureService, string> = {
  core: `${ALMONDYOUNG_API_BASE_URL}/event-failures`,
  'channel-adapter': `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/event-failures`,
};

/** 커서 0 은 «처음부터»다(서버가 0 이하를 무시한다) */
function cursorParams(cursor: number) {
  return cursor > 0 ? { cursor } : undefined;
}

export const eventFailuresClient = {
  summary: async (service: EventFailureService): Promise<EventFailuresSummary> =>
    (await client.get<EventFailuresSummary>(`${BASE[service]}/summary`)).data,

  deadLetters: async (
    service: EventFailureService,
    cursor: number
  ): Promise<CursorPage<DeadLetterSequenceItem>> =>
    (
      await client.get<CursorPage<DeadLetterSequenceItem>>(`${BASE[service]}/dead-letters`, {
        params: cursorParams(cursor),
      })
    ).data,

  deadLetter: async (service: EventFailureService, id: number): Promise<DeadLetterDetail> =>
    (await client.get<DeadLetterDetail>(`${BASE[service]}/dead-letters/${id}`)).data,

  redrive: async (service: EventFailureService, id: number): Promise<RedriveResult> =>
    (await client.post<RedriveResult>(`${BASE[service]}/dead-letters/${id}/redrive`)).data,

  discardDeadLetter: async (
    service: EventFailureService,
    id: number,
    reason: string
  ): Promise<RedriveResult> =>
    (await client.post<RedriveResult>(`${BASE[service]}/dead-letters/${id}/discard`, { reason }))
      .data,

  redriveAll: async (service: EventFailureService): Promise<RedriveAllResult> =>
    (await client.post<RedriveAllResult>(`${BASE[service]}/dead-letters/redrive-all`)).data,

  outboxFailed: async (
    service: EventFailureService,
    cursor: number
  ): Promise<CursorPage<OutboxFailedItem>> =>
    (
      await client.get<CursorPage<OutboxFailedItem>>(`${BASE[service]}/outbox/failed`, {
        params: cursorParams(cursor),
      })
    ).data,

  outboxRow: async (service: EventFailureService, id: number): Promise<OutboxFailureDetail> =>
    (await client.get<OutboxFailureDetail>(`${BASE[service]}/outbox/${id}`)).data,

  resend: async (service: EventFailureService, id: number): Promise<ResendResult> =>
    (await client.post<ResendResult>(`${BASE[service]}/outbox/${id}/resend`)).data,

  discardOutbox: async (
    service: EventFailureService,
    id: number,
    reason: string
  ): Promise<{ status: 'DISCARDED' }> =>
    (await client.post<{ status: 'DISCARDED' }>(`${BASE[service]}/outbox/${id}/discard`, { reason }))
      .data,

  resendAll: async (service: EventFailureService): Promise<ResendAllResult> =>
    (await client.post<ResendAllResult>(`${BASE[service]}/outbox/resend-all`)).data,
};
```

- [ ] **Step 3: index 에 export 추가**

`apps/admin-web/src/lib/api/domains/events/index.ts` 끝에 덧붙인다:

```ts
export { eventFailuresClient } from './failures.client';
export { EVENT_FAILURE_SERVICES } from './failures.types';
export type {
  EventFailureService,
  EventFailuresSummary,
  CursorPage,
  DeadLetterSequenceItem,
  DeadLetterRow,
  FailureActionRow,
  DeadLetterDetail,
  RedriveStop,
  RedriveResult,
  RedriveAllResult,
  OutboxFailedItem,
  OutboxFailureDetail,
  ResendResult,
  ResendAllResult,
} from './failures.types';
```

- [ ] **Step 4: 타입 검사**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 출력 없음(에러 0)

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/api/domains/events/
git commit -m "feat(admin-web): 이벤트 실패 출구 API 클라이언트 (#1016 7·8번)"
```

---

### Task 2: 표시 규칙 순수 함수

**Files:**
- Create: `apps/admin-web/src/features/events/failures/display.ts`
- Test: `apps/admin-web/src/features/events/failures/display.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 타입(`import type` 만), `formatDwell` from `@/lib/utils/format-dwell`
- Produces (Task 4·5·6 이 쓴다):
  - `REASON_MAX = 500`
  - `dwellSince(iso: string | null, now: Date): string`
  - `errorOneLine(name: string | null, message: string | null): string`
  - `errorMessageOf(error: unknown): string`
  - `loadErrorText(error: unknown): string`
  - `isStopped(result: RedriveResult): boolean`
  - `redriveResultText(result: RedriveResult): string`
  - `discardResultText(result: RedriveResult): string`
  - `redriveAllResultText(result: RedriveAllResult): string`
  - `resendResultText(result: ResendResult): string`
  - `resendAllResultText(result: ResendAllResult): string`
  - `discardFollowUpText(behind: number): string | null`
  - `reasonError(reason: string): string | null`
  - `tabBadgeCount(summary: EventFailuresSummary | undefined): number | null`
  - `redriveAllConfirmText(summary: EventFailuresSummary | undefined): string`
  - `resendAllConfirmText(summary: EventFailuresSummary | undefined): string`
  - `statusLabel(status: string): string`
  - `isUnresolved(status: string): boolean`
  - `actionLabel(kind: 'dead_letter' | 'outbox', action: string, outcome: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/admin-web/src/features/events/failures/display.spec.ts`:

```ts
import {
  REASON_MAX,
  actionLabel,
  discardFollowUpText,
  discardResultText,
  dwellSince,
  errorMessageOf,
  errorOneLine,
  isStopped,
  isUnresolved,
  loadErrorText,
  reasonError,
  redriveAllConfirmText,
  redriveAllResultText,
  redriveResultText,
  resendAllConfirmText,
  resendAllResultText,
  resendResultText,
  statusLabel,
  tabBadgeCount,
} from './display';
import type { EventFailuresSummary } from '@/lib/api/domains/events/failures.types';

const summary = (dl: { failed: number; held: number }, outboxFailed: number): EventFailuresSummary => ({
  deadLetters: { ...dl, oldestFailedAt: null },
  outbox: { failed: outboxFailed, oldestFailedAt: null },
});

describe('dwellSince', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('정체 보드와 같은 표기로 체류를 적는다', () => {
    expect(dwellSince('2026-10-15T10:30:00Z', now)).toBe('1시간 30분');
    expect(dwellSince('2026-10-13T12:00:00Z', now)).toBe('2일');
  });

  it('시각이 없으면 줄표', () => {
    expect(dwellSince(null, now)).toBe('-');
  });

  it('시계가 어긋나 미래 시각이 와도 음수를 보이지 않는다', () => {
    expect(dwellSince('2026-10-15T12:05:00Z', now)).toBe('0분');
  });
});

describe('errorOneLine', () => {
  it('이름과 첫 줄을 잇는다', () => {
    expect(errorOneLine('TimeoutError', 'upstream timed out\n    at foo (bar.ts:1)')).toBe(
      'TimeoutError: upstream timed out'
    );
  });

  it('긴 메시지는 120자에서 자르고 말줄임표를 붙인다', () => {
    const line = errorOneLine(null, 'x'.repeat(300));
    expect(line).toHaveLength(121);
    expect(line.endsWith('…')).toBe(true);
  });

  it('앞쪽 빈 줄은 건너뛴다', () => {
    expect(errorOneLine(null, '\n\n  real cause  \nmore')).toBe('real cause');
  });

  it('둘 다 없으면 줄표, 이름만 있으면 이름', () => {
    expect(errorOneLine(null, null)).toBe('-');
    expect(errorOneLine('ZodError', null)).toBe('ZodError');
  });
});

describe('errorMessageOf / loadErrorText', () => {
  it('서버 문구를 그대로 보여 준다 — 마이그 전 배포의 «시작되지 않았다»가 사람에게 닿게', () => {
    const err = new Error('DeadLetterRuntime 이 시작되지 않았다 — ② 마이그 …');
    expect(errorMessageOf(err)).toBe('DeadLetterRuntime 이 시작되지 않았다 — ② 마이그 …');
    expect(loadErrorText(err)).toBe('불러오지 못했습니다 — DeadLetterRuntime 이 시작되지 않았다 — ② 마이그 …');
  });

  it('Error 가 아니면 일반 문구', () => {
    expect(errorMessageOf('boom')).toBe('요청이 실패했습니다');
    expect(loadErrorText(undefined)).toBe('불러오지 못했습니다 — 요청이 실패했습니다');
  });
});

describe('redriveResultText', () => {
  it('끝까지 처리했으면 건수', () => {
    expect(redriveResultText({ processed: 3, stoppedAt: null })).toBe('3건 처리');
  });

  it('멈췄으면 멈춘 사실과 오류 이름을 숨기지 않는다', () => {
    const r = { processed: 1, stoppedAt: { id: 9, errorName: 'TimeoutError', errorMessage: 'x' } };
    expect(redriveResultText(r)).toBe('1건 처리 후 멈춤 — TimeoutError');
    expect(isStopped(r)).toBe(true);
  });

  it('처음 행에서 멈추면 0건 처리 후 멈춤', () => {
    expect(redriveResultText({ processed: 0, stoppedAt: { id: 9, errorName: null, errorMessage: null } })).toBe(
      '0건 처리 후 멈춤 — 오류'
    );
  });

  it('처리할 게 없었으면 그렇게 말한다', () => {
    expect(redriveResultText({ processed: 0, stoppedAt: null })).toBe('처리할 것이 없습니다');
    expect(isStopped({ processed: 0, stoppedAt: null })).toBe(false);
  });
});

describe('discardResultText', () => {
  it('머리 아닌 행 종결 — 아무것도 흐르지 않았다', () => {
    expect(discardResultText({ processed: 0, stoppedAt: null })).toBe('종결');
  });

  it('머리 종결 뒤 이어서 처리된 건수', () => {
    expect(discardResultText({ processed: 2, stoppedAt: null })).toBe('종결 · 뒤 2건 처리');
  });

  it('이어서 처리하다 멈췄으면 멈춤을 알린다', () => {
    expect(
      discardResultText({ processed: 1, stoppedAt: { id: 5, errorName: 'ConflictError', errorMessage: null } })
    ).toBe('종결 · 뒤 1건 처리 후 멈춤 — ConflictError');
  });
});

describe('redriveAllResultText', () => {
  it('성공·멈춤(오류 이름별, 많은 순)·건너뜀을 한 문장으로', () => {
    expect(
      redriveAllResultText({
        sequences: 13,
        succeeded: 10,
        stopped: 3,
        busy: 0,
        stoppedByError: { ZodError: 1, TimeoutError: 2 },
      })
    ).toBe('성공 10 · 멈춤 3 (TimeoutError 2, ZodError 1)');
  });

  it('진행 중이라 건너뛴 순서를 센다', () => {
    expect(
      redriveAllResultText({ sequences: 2, succeeded: 1, stopped: 0, busy: 1, stoppedByError: {} })
    ).toBe('성공 1 · 진행 중이라 건너뜀 1');
  });

  it('순서가 없었으면', () => {
    expect(redriveAllResultText({ sequences: 0, succeeded: 0, stopped: 0, busy: 0, stoppedByError: {} })).toBe(
      '다시 넣을 것이 없습니다'
    );
  });
});

describe('resendResultText / resendAllResultText', () => {
  it('단건', () => {
    expect(resendResultText({ status: 'PUBLISHED' })).toBe('보냈습니다');
    expect(resendResultText({ status: 'FAILED', error: 'KafkaJSConnectionError\nstack' })).toBe(
      '실패 — KafkaJSConnectionError'
    );
  });

  it('전체 — 그 사이 다른 사람이 처리한 행은 건너뜀으로 센다', () => {
    expect(resendAllResultText({ total: 5, published: 3, failed: [{ id: 1, error: 'x' }] })).toBe(
      '성공 3 · 실패 1 · 건너뜀 1'
    );
    expect(resendAllResultText({ total: 2, published: 2, failed: [] })).toBe('성공 2');
    expect(resendAllResultText({ total: 0, published: 0, failed: [] })).toBe('다시 보낼 것이 없습니다');
  });
});

describe('discardFollowUpText', () => {
  it('뒤에 기다리는 게 있으면 이어서 처리된다고 미리 알린다', () => {
    expect(discardFollowUpText(2)).toBe('뒤 2건이 이어서 처리됩니다');
  });

  it('없으면 아무 문구도 없다 — 머리 아닌 행 종결에 거짓 안내를 하지 않는다', () => {
    expect(discardFollowUpText(0)).toBeNull();
  });
});

describe('reasonError', () => {
  it('공백뿐이면 거부', () => {
    expect(reasonError('   ')).toBe('사유를 입력하세요');
  });

  it(`${REASON_MAX}자까지 허용, 넘으면 거부(앞뒤 공백은 세지 않는다)`, () => {
    expect(reasonError('a'.repeat(REASON_MAX))).toBeNull();
    expect(reasonError(`  ${'a'.repeat(REASON_MAX)}  `)).toBeNull();
    expect(reasonError('a'.repeat(REASON_MAX + 1))).toBe(`${REASON_MAX}자 이내로 입력하세요`);
  });
});

describe('tabBadgeCount', () => {
  it('안 푼 컨슈머 실패(failed+held)와 outbox FAILED 의 합', () => {
    expect(tabBadgeCount(summary({ failed: 2, held: 3 }, 4))).toBe(9);
  });

  it('요약이 없으면 null — 0 으로 보이면 «정상»으로 오독한다', () => {
    expect(tabBadgeCount(undefined)).toBeNull();
  });
});

describe('확인 문구', () => {
  it('전체 다시 넣기', () => {
    expect(redriveAllConfirmText(summary({ failed: 4, held: 6 }, 0))).toBe(
      '실패 4건 · 보류 6건을 순서마다 다시 넣습니다'
    );
    expect(redriveAllConfirmText(summary({ failed: 4, held: 0 }, 0))).toBe('실패 4건을 순서마다 다시 넣습니다');
    expect(redriveAllConfirmText(undefined)).toBe('안 푼 실패를 순서마다 다시 넣습니다');
  });

  it('전체 다시 보내기', () => {
    expect(resendAllConfirmText(summary({ failed: 0, held: 0 }, 7))).toBe('7건을 오래된 순서로 다시 보냅니다');
    expect(resendAllConfirmText(undefined)).toBe('실패한 행을 오래된 순서로 다시 보냅니다');
  });
});

describe('statusLabel / isUnresolved / actionLabel', () => {
  it('상태 이름', () => {
    expect(statusLabel('failed')).toBe('실패');
    expect(statusLabel('held')).toBe('보류');
    expect(statusLabel('redriven')).toBe('다시 넣음');
    expect(statusLabel('discarded')).toBe('종결');
    expect(statusLabel('weird')).toBe('weird');
  });

  it('안 푼 상태는 failed·held 뿐', () => {
    expect(isUnresolved('failed')).toBe(true);
    expect(isUnresolved('held')).toBe(true);
    expect(isUnresolved('redriven')).toBe(false);
    expect(isUnresolved('discarded')).toBe(false);
  });

  it('조치 이름 — outbox 의 redrive 는 «다시 보내기»', () => {
    expect(actionLabel('dead_letter', 'redrive', 'succeeded')).toBe('다시 넣기');
    expect(actionLabel('dead_letter', 'redrive', 'failed')).toBe('다시 넣기 실패');
    expect(actionLabel('outbox', 'redrive', 'succeeded')).toBe('다시 보내기');
    expect(actionLabel('outbox', 'redrive', 'failed')).toBe('다시 보내기 실패');
    expect(actionLabel('outbox', 'discard', 'succeeded')).toBe('종결');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- apps/admin-web/src/features/events/failures/display.spec.ts`
Expected: FAIL — `Cannot find module './display'`

- [ ] **Step 3: 구현**

`apps/admin-web/src/features/events/failures/display.ts`:

```ts
// 이벤트 실패 화면의 표시 규칙 (#1016 7·8번, 스펙 §10). React·axios·react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능하므로 화면에 나가는 문장은 전부 여기서 만들고 여기서 검증한다.

import { formatDwell } from '@/lib/utils/format-dwell';
import type {
  EventFailuresSummary,
  RedriveAllResult,
  RedriveResult,
  ResendAllResult,
  ResendResult,
} from '@/lib/api/domains/events/failures.types';

/** 서버 `DiscardFailureDto` 의 `@MaxLength(500)` 과 같다 */
export const REASON_MAX = 500;

const ERROR_LINE_MAX = 120;

export function dwellSince(iso: string | null, now: Date): string {
  if (!iso) return '-';
  return formatDwell(Math.max(0, now.getTime() - new Date(iso).getTime()));
}

/** 목록 칸용. 스택이 섞인 여러 줄 메시지는 첫 내용 줄만, 길면 자른다 */
export function errorOneLine(name: string | null, message: string | null): string {
  const first = (message ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const text = [name, first].filter((v): v is string => !!v).join(': ');
  if (!text) return '-';
  return text.length > ERROR_LINE_MAX ? `${text.slice(0, ERROR_LINE_MAX)}…` : text;
}

/** axios 인터셉터가 서버 문구를 `CustomError.message` 에 담아 던진다 */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '요청이 실패했습니다';
}

export function loadErrorText(error: unknown): string {
  return `불러오지 못했습니다 — ${errorMessageOf(error)}`;
}

export function isStopped(result: RedriveResult): boolean {
  return result.stoppedAt !== null;
}

function stopSuffix(result: RedriveResult): string {
  return `${result.processed}건 처리 후 멈춤 — ${result.stoppedAt?.errorName ?? '오류'}`;
}

export function redriveResultText(result: RedriveResult): string {
  if (isStopped(result)) return stopSuffix(result);
  return result.processed > 0 ? `${result.processed}건 처리` : '처리할 것이 없습니다';
}

/** 종결 결과. 머리를 종결했으면 뒤 보류가 이어서 다시 넣어진 결과가 함께 온다 */
export function discardResultText(result: RedriveResult): string {
  if (isStopped(result)) return `종결 · 뒤 ${stopSuffix(result)}`;
  return result.processed > 0 ? `종결 · 뒤 ${result.processed}건 처리` : '종결';
}

export function redriveAllResultText(result: RedriveAllResult): string {
  if (result.sequences === 0) return '다시 넣을 것이 없습니다';
  const parts = [`성공 ${result.succeeded}`];
  if (result.stopped > 0) {
    const byError = Object.entries(result.stoppedByError)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `${name} ${n}`)
      .join(', ');
    parts.push(byError ? `멈춤 ${result.stopped} (${byError})` : `멈춤 ${result.stopped}`);
  }
  if (result.busy > 0) parts.push(`진행 중이라 건너뜀 ${result.busy}`);
  return parts.join(' · ');
}

export function resendResultText(result: ResendResult): string {
  return result.status === 'PUBLISHED' ? '보냈습니다' : `실패 — ${errorOneLine(null, result.error)}`;
}

export function resendAllResultText(result: ResendAllResult): string {
  if (result.total === 0) return '다시 보낼 것이 없습니다';
  const parts = [`성공 ${result.published}`];
  if (result.failed.length > 0) parts.push(`실패 ${result.failed.length}`);
  // 서버는 그 사이 다른 사람이 처리한 행(409)을 세지 않고 건너뛴다
  const skipped = result.total - result.published - result.failed.length;
  if (skipped > 0) parts.push(`건너뜀 ${skipped}`);
  return parts.join(' · ');
}

/** 종결 대화상자의 미리 알림. 머리 아닌 행(뒤 0)에는 문구가 없다 — 아무것도 흐르지 않으므로 */
export function discardFollowUpText(behind: number): string | null {
  return behind > 0 ? `뒤 ${behind}건이 이어서 처리됩니다` : null;
}

export function reasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return '사유를 입력하세요';
  if (trimmed.length > REASON_MAX) return `${REASON_MAX}자 이내로 입력하세요`;
  return null;
}

/** 요약을 아직 못 받았거나 실패했으면 null — 0 을 보이면 «정상»으로 읽힌다 */
export function tabBadgeCount(summary: EventFailuresSummary | undefined): number | null {
  if (!summary) return null;
  return summary.deadLetters.failed + summary.deadLetters.held + summary.outbox.failed;
}

export function redriveAllConfirmText(summary: EventFailuresSummary | undefined): string {
  if (!summary) return '안 푼 실패를 순서마다 다시 넣습니다';
  const { failed, held } = summary.deadLetters;
  return held > 0
    ? `실패 ${failed}건 · 보류 ${held}건을 순서마다 다시 넣습니다`
    : `실패 ${failed}건을 순서마다 다시 넣습니다`;
}

export function resendAllConfirmText(summary: EventFailuresSummary | undefined): string {
  if (!summary) return '실패한 행을 오래된 순서로 다시 보냅니다';
  return `${summary.outbox.failed}건을 오래된 순서로 다시 보냅니다`;
}

const STATUS_LABELS: Record<string, string> = {
  failed: '실패',
  held: '보류',
  redriven: '다시 넣음',
  discarded: '종결',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function isUnresolved(status: string): boolean {
  return status === 'failed' || status === 'held';
}

export function actionLabel(kind: 'dead_letter' | 'outbox', action: string, outcome: string): string {
  if (action === 'discard') return '종결';
  const base = kind === 'outbox' ? '다시 보내기' : '다시 넣기';
  return outcome === 'failed' ? `${base} 실패` : base;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- apps/admin-web/src/features/events/failures/display.spec.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/events/failures/display.ts apps/admin-web/src/features/events/failures/display.spec.ts
git commit -m "feat(admin-web): 이벤트 실패 화면 표시 규칙 (#1016 7·8번)"
```

---

### Task 3: 쿼리 키·쿼리·뮤테이션 훅

**Files:**
- Modify: `apps/admin-web/src/lib/services/events/query-keys.ts`
- Create: `apps/admin-web/src/lib/services/events/failures.queries.ts`
- Create: `apps/admin-web/src/lib/services/events/failures.mutations.ts`
- Modify: `apps/admin-web/src/lib/services/events/index.ts`

**Interfaces:**
- Consumes: Task 1 `eventFailuresClient`, `EventFailureService`
- Produces (Task 4·5·6 이 쓴다):
  - `eventQueryKeys.failures(service)` 와 하위 키
  - `useEventFailureSummary(service)` → `UseQueryResult<EventFailuresSummary>`
  - `useDeadLetterSequences(service)` → infinite, `data.pages[].items`
  - `useDeadLetterDetail(service, id: number)`
  - `useOutboxFailures(service)` → infinite
  - `useOutboxFailureDetail(service, id: number)`
  - `useRedriveDeadLetter(service)` — `mutate(id: number)`
  - `useDiscardDeadLetter(service)` — `mutate({ id, reason })`
  - `useRedriveAllDeadLetters(service)` — `mutate()`
  - `useResendOutbox(service)` — `mutate(id: number)`
  - `useDiscardOutbox(service)` — `mutate({ id, reason })`
  - `useResendAllOutbox(service)` — `mutate()`

훅은 렌더 없이는 테스트할 수 없다. 키 모양만 `tsc` 와 리뷰로 지킨다 — 핵심은 **모든 키가 `['events', 'failures', service]` 로 시작하고 `undefined` 를 섞지 않는 것**(무효화 접두사 일치).

- [ ] **Step 1: 쿼리 키 추가**

`apps/admin-web/src/lib/services/events/query-keys.ts` 의 `eventQueryKeys` 객체 마지막 키 뒤에 덧붙인다(파일 머리에 import 추가):

```ts
import type { EventFailureService } from '../../api/domains/events';
```

```ts
  // 이벤트 실패 출구 (#1016 7·8번). 뮤테이션은 `failures(service)` 접두사로 그 서비스 전부를 무효화한다 —
  // 그래서 하위 키는 전부 이 접두사로 시작하고 undefined 를 섞지 않는다.
  failures: (service: EventFailureService) => ['events', 'failures', service] as const,
  failureSummary: (service: EventFailureService) =>
    ['events', 'failures', service, 'summary'] as const,
  deadLetterList: (service: EventFailureService) =>
    ['events', 'failures', service, 'dead-letters', 'list'] as const,
  deadLetterDetail: (service: EventFailureService, id: number) =>
    ['events', 'failures', service, 'dead-letters', 'detail', id] as const,
  outboxList: (service: EventFailureService) =>
    ['events', 'failures', service, 'outbox', 'list'] as const,
  outboxDetail: (service: EventFailureService, id: number) =>
    ['events', 'failures', service, 'outbox', 'detail', id] as const,
```

- [ ] **Step 2: 쿼리 훅**

`apps/admin-web/src/lib/services/events/failures.queries.ts`:

```ts
'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { eventQueryKeys } from './query-keys';
import { eventFailuresClient, type EventFailureService } from '../../api/domains/events';

// 운영 화면이라 캐시를 믿지 않는다(staleTime 0). 재시도는 끈다 — axios 가 GET 5xx 를 이미 두 번 재시도하므로
// react-query 재시도까지 겹치면 마이그 전 배포의 500 이 화면에 늦게 뜬다.
const LIVE = { staleTime: 0, retry: false } as const;

export const useEventFailureSummary = (service: EventFailureService) =>
  useQuery({
    queryKey: eventQueryKeys.failureSummary(service),
    queryFn: () => eventFailuresClient.summary(service),
    refetchInterval: 30_000,
    ...LIVE,
  });

export const useDeadLetterSequences = (service: EventFailureService) =>
  useInfiniteQuery({
    queryKey: eventQueryKeys.deadLetterList(service),
    queryFn: ({ pageParam }) => eventFailuresClient.deadLetters(service, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...LIVE,
  });

export const useDeadLetterDetail = (service: EventFailureService, id: number) =>
  useQuery({
    queryKey: eventQueryKeys.deadLetterDetail(service, id),
    queryFn: () => eventFailuresClient.deadLetter(service, id),
    ...LIVE,
  });

export const useOutboxFailures = (service: EventFailureService) =>
  useInfiniteQuery({
    queryKey: eventQueryKeys.outboxList(service),
    queryFn: ({ pageParam }) => eventFailuresClient.outboxFailed(service, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...LIVE,
  });

export const useOutboxFailureDetail = (service: EventFailureService, id: number) =>
  useQuery({
    queryKey: eventQueryKeys.outboxDetail(service, id),
    queryFn: () => eventFailuresClient.outboxRow(service, id),
    ...LIVE,
  });
```

- [ ] **Step 3: 뮤테이션 훅**

`apps/admin-web/src/lib/services/events/failures.mutations.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { eventQueryKeys } from './query-keys';
import { eventFailuresClient, type EventFailureService } from '../../api/domains/events';

/**
 * 성공·실패와 무관하게(onSettled) 그 서비스의 실패 쿼리를 전부 다시 읽는다.
 * 409(«이미 진행 중»·«이미 처리된 행»)는 화면이 낡았다는 뜻이라 실패 뒤에도 새로 읽어야 한다.
 */
function useInvalidateFailures(service: EventFailureService) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: eventQueryKeys.failures(service) });
}

export function useRedriveDeadLetter(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: (id: number) => eventFailuresClient.redrive(service, id),
    onSettled: invalidate,
  });
}

export function useDiscardDeadLetter(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      eventFailuresClient.discardDeadLetter(service, id, reason),
    onSettled: invalidate,
  });
}

export function useRedriveAllDeadLetters(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: () => eventFailuresClient.redriveAll(service),
    onSettled: invalidate,
  });
}

export function useResendOutbox(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: (id: number) => eventFailuresClient.resend(service, id),
    onSettled: invalidate,
  });
}

export function useDiscardOutbox(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      eventFailuresClient.discardOutbox(service, id, reason),
    onSettled: invalidate,
  });
}

export function useResendAllOutbox(service: EventFailureService) {
  const invalidate = useInvalidateFailures(service);
  return useMutation({
    mutationFn: () => eventFailuresClient.resendAll(service),
    onSettled: invalidate,
  });
}
```

- [ ] **Step 4: index 에 export 추가**

`apps/admin-web/src/lib/services/events/index.ts` 끝에 덧붙인다:

```ts
export {
  useEventFailureSummary,
  useDeadLetterSequences,
  useDeadLetterDetail,
  useOutboxFailures,
  useOutboxFailureDetail,
} from './failures.queries';
export {
  useRedriveDeadLetter,
  useDiscardDeadLetter,
  useRedriveAllDeadLetters,
  useResendOutbox,
  useDiscardOutbox,
  useResendAllOutbox,
} from './failures.mutations';
```

- [ ] **Step 5: 타입 검사**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/lib/services/events/
git commit -m "feat(admin-web): 이벤트 실패 쿼리·뮤테이션 훅 (#1016 7·8번)"
```

---

### Task 4: 공용 대화상자·상세 조각 + «받다 실패» 목록

**Files:**
- Create: `apps/admin-web/src/features/events/failures/components/discard-dialog.tsx`
- Create: `apps/admin-web/src/features/events/failures/components/confirm-all-dialog.tsx`
- Create: `apps/admin-web/src/features/events/failures/components/detail-parts.tsx`
- Create: `apps/admin-web/src/features/events/failures/components/dead-letter-section.tsx`

**Interfaces:**
- Consumes: Task 2 의 표시 함수, Task 3 의 훅, `@/components/ui/{dialog,alert-dialog,button,textarea}`, `toast` from `sonner`
- Produces:
  - `DiscardTarget = { id: number; label: string; behind: number }`
  - `<DiscardDialog target={DiscardTarget | null} pending={boolean} onClose={() => void} onSubmit={(reason: string) => void} />`
  - `<ConfirmAllDialog open title description pending onOpenChange onConfirm />`
  - `<JsonBlock value={unknown} />`, `<ActionLog kind actions />`, `<Fields rows={Array<[string, ReactNode]>} />`
  - `<DeadLetterSection service now />`

컴포넌트는 테스트할 수 없다 — 문장은 전부 Task 2 함수에서 오고, 이 태스크는 배선만 한다. 검증은 `tsc` 와 Task 7 의 수동 확인이다.

- [ ] **Step 1: 종결 대화상자**

`apps/admin-web/src/features/events/failures/components/discard-dialog.tsx`:

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
import { REASON_MAX, discardFollowUpText, reasonError } from '../display';

export interface DiscardTarget {
  id: number;
  /** 무엇을 종결하는지 한 줄 — 이벤트 종류 · 순서 키 */
  label: string;
  /** 종결하면 이어서 흐를 뒤 행 수. 머리 아닌 행이면 0 */
  behind: number;
}

interface DiscardDialogProps {
  target: DiscardTarget | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function DiscardDialog({ target, pending, onClose, onSubmit }: DiscardDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* key 로 대상이 바뀔 때마다 입력을 비운다 */}
        {target && <DiscardForm key={target.id} target={target} pending={pending} onClose={onClose} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  );
}

function DiscardForm({
  target,
  pending,
  onClose,
  onSubmit,
}: {
  target: DiscardTarget;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const error = reasonError(reason);
  const followUp = discardFollowUpText(target.behind);

  return (
    <>
      <DialogHeader>
        <DialogTitle>종결</DialogTitle>
        <DialogDescription className="font-mono text-xs">{target.label}</DialogDescription>
      </DialogHeader>
      <Textarea
        value={reason}
        maxLength={REASON_MAX}
        placeholder="사유"
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        autoFocus
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="text-red-600">{touched ? error : null}</span>
        <span>
          {reason.length}/{REASON_MAX}
        </span>
      </div>
      {followUp && <p className="text-sm font-medium">{followUp}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button
          variant="destructive"
          disabled={error !== null || pending}
          onClick={() => onSubmit(reason.trim())}
        >
          종결
        </Button>
      </DialogFooter>
    </>
  );
}
```

- [ ] **Step 2: 전체 확인 대화상자**

`apps/admin-web/src/features/events/failures/components/confirm-all-dialog.tsx`:

```tsx
'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmAllDialogProps {
  open: boolean;
  title: string;
  description: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmAllDialog({ open, title, description, pending, onOpenChange, onConfirm }: ConfirmAllDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            실행
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: 상세 조각**

`apps/admin-web/src/features/events/failures/components/detail-parts.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import type { FailureActionRow } from '@/lib/api/domains/events';
import { actionLabel } from '../display';

export function Fields({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ErrorBlock({ text }: { text: string }) {
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-800">{text}</pre>;
}

export function ActionLog({ kind, actions }: { kind: 'dead_letter' | 'outbox'; actions: FailureActionRow[] }) {
  if (actions.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs">
      {actions.map((a) => (
        <li key={a.id} className="flex gap-2">
          <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString('ko-KR')}</span>
          <span>{actionLabel(kind, a.action, a.outcome)}</span>
          <span className="text-muted-foreground">{a.actor ?? '-'}</span>
          {a.note && <span className="break-all">{a.note}</span>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: «받다 실패» 섹션**

`apps/admin-web/src/features/events/failures/components/dead-letter-section.tsx`:

```tsx
'use client';

import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { DeadLetterSequenceItem, EventFailureService } from '@/lib/api/domains/events';
import {
  useDeadLetterDetail,
  useDeadLetterSequences,
  useDiscardDeadLetter,
  useEventFailureSummary,
  useRedriveAllDeadLetters,
  useRedriveDeadLetter,
} from '@/lib/services/events';
import {
  discardResultText,
  dwellSince,
  errorMessageOf,
  errorOneLine,
  isStopped,
  isUnresolved,
  loadErrorText,
  redriveAllConfirmText,
  redriveAllResultText,
  redriveResultText,
  statusLabel,
} from '../display';
import { ConfirmAllDialog } from './confirm-all-dialog';
import { DiscardDialog, type DiscardTarget } from './discard-dialog';
import { ActionLog, ErrorBlock, Fields, JsonBlock } from './detail-parts';

interface SectionProps {
  service: EventFailureService;
  now: Date;
}

function labelOf(eventType: string | null, sequenceKey: string | null): string {
  return `${eventType ?? '(해석 불가)'} · ${sequenceKey ?? '-'}`;
}

export function DeadLetterSection({ service, now }: SectionProps) {
  const list = useDeadLetterSequences(service);
  const summary = useEventFailureSummary(service);
  const redrive = useRedriveDeadLetter(service);
  const discard = useDiscardDeadLetter(service);
  const redriveAll = useRedriveAllDeadLetters(service);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const onRedrive = (id: number) =>
    redrive.mutate(id, {
      onSuccess: (r) => {
        if (isStopped(r)) toast.error(redriveResultText(r));
        else toast.success(redriveResultText(r));
      },
      onError: (e) => toast.error(errorMessageOf(e)),
    });

  const onDiscard = (reason: string) => {
    if (!discardTarget) return;
    discard.mutate(
      { id: discardTarget.id, reason },
      {
        onSuccess: (r) => {
          setDiscardTarget(null);
          if (isStopped(r)) toast.error(discardResultText(r));
          else toast.success(discardResultText(r));
        },
        onError: (e) => toast.error(errorMessageOf(e)),
      }
    );
  };

  const onRedriveAll = () =>
    redriveAll.mutate(undefined, {
      onSuccess: (r) => {
        if (r.stopped > 0) toast.error(redriveAllResultText(r));
        else toast.success(redriveAllResultText(r));
      },
      onError: (e) => toast.error(errorMessageOf(e)),
    });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">받다 실패</h2>
        {items.length > 0 && (
          <Button size="sm" variant="outline" disabled={redriveAll.isPending} onClick={() => setConfirmAll(true)}>
            전체 다시 넣기
          </Button>
        )}
      </div>

      {list.isError ? (
        <p className="text-sm text-red-600">{loadErrorText(list.error)}</p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">실패 없음</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-48" />
            <col className="w-56" />
            <col className="w-24" />
            <col />
            <col className="w-16" />
            <col className="w-44" />
          </colgroup>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">이벤트</th>
              <th>순서 키</th>
              <th>체류</th>
              <th>오류</th>
              <th>뒤 보류</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className="cursor-pointer border-t hover:bg-muted/40"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <td className="truncate py-1.5" title={`${item.topic} · ${item.handler}`}>
                    {item.eventType ?? '(해석 불가)'}
                  </td>
                  <td className="truncate font-mono text-xs">{item.sequenceKey ?? '-'}</td>
                  <td>{dwellSince(item.firstFailedAt, now)}</td>
                  <td className="truncate" title={item.errorMessage ?? undefined}>
                    {errorOneLine(item.errorName, item.errorMessage)}
                  </td>
                  <td>{item.heldBehind > 0 ? item.heldBehind : ''}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={redrive.isPending && redrive.variables === item.id}
                      onClick={() => onRedrive(item.id)}
                    >
                      다시 넣기
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDiscardTarget({
                          id: item.id,
                          label: labelOf(item.eventType, item.sequenceKey),
                          behind: item.heldBehind,
                        })
                      }
                    >
                      종결
                    </Button>
                  </td>
                </tr>
                {expanded === item.id && (
                  <tr>
                    <td colSpan={6} className="pb-3">
                      <DeadLetterDetailView
                        service={service}
                        head={item}
                        now={now}
                        onDiscard={setDiscardTarget}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {list.hasNextPage && (
        <Button size="sm" variant="ghost" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          더 보기
        </Button>
      )}

      <DiscardDialog
        target={discardTarget}
        pending={discard.isPending}
        onClose={() => setDiscardTarget(null)}
        onSubmit={onDiscard}
      />
      <ConfirmAllDialog
        open={confirmAll}
        title="전체 다시 넣기"
        description={redriveAllConfirmText(summary.data)}
        pending={redriveAll.isPending}
        onOpenChange={setConfirmAll}
        onConfirm={onRedriveAll}
      />
    </section>
  );
}

function DeadLetterDetailView({
  service,
  head,
  now,
  onDiscard,
}: {
  service: EventFailureService;
  head: DeadLetterSequenceItem;
  now: Date;
  onDiscard: (target: DiscardTarget) => void;
}) {
  const detail = useDeadLetterDetail(service, head.id);
  if (detail.isError) return <p className="text-sm text-red-600">{loadErrorText(detail.error)}</p>;
  if (!detail.data) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  const { row, sequence, actions } = detail.data;

  return (
    <div className="flex flex-col gap-3 rounded bg-muted/30 p-3">
      <Fields
        rows={[
          ['토픽', row.topic],
          ['핸들러', row.handler],
          ['메시지', row.messageId],
          ['위치', `${row.kafkaPartition}:${row.kafkaOffset}`],
          ['다시 넣은 횟수', row.redriveCount],
        ]}
      />
      {(row.errorName || row.errorMessage) && (
        <ErrorBlock text={[row.errorName, row.errorMessage].filter(Boolean).join(': ')} />
      )}
      {sequence.length > 1 && (
        <ul className="text-xs">
          {sequence.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-0.5">
              <span className="w-12 text-muted-foreground">#{r.id}</span>
              <span className="w-40 truncate">{r.eventType ?? '(해석 불가)'}</span>
              <span className="w-16">{statusLabel(r.status)}</span>
              <span className="w-20">{dwellSince(r.firstFailedAt, now)}</span>
              {/* 머리는 목록 행의 버튼으로 종결한다. 머리 아닌 행 종결은 아무것도 흐르게 하지 않는다(스펙 §7.5) */}
              {isUnresolved(r.status) && r.id !== head.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6"
                  onClick={() => onDiscard({ id: r.id, label: labelOf(r.eventType, r.sequenceKey), behind: 0 })}
                >
                  종결
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <JsonBlock value={row.envelope} />
      <ActionLog kind="dead_letter" actions={actions} />
    </div>
  );
}
```

- [ ] **Step 5: 타입 검사**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/features/events/failures/components/
git commit -m "feat(admin-web): 이벤트 실패 «받다 실패» 목록·종결 대화상자 (#1016 8번)"
```

---

### Task 5: «보내다 실패» 목록

**Files:**
- Create: `apps/admin-web/src/features/events/failures/components/outbox-section.tsx`

**Interfaces:**
- Consumes: Task 4 의 `DiscardDialog`·`DiscardTarget`·`ConfirmAllDialog`·`Fields`·`JsonBlock`·`ErrorBlock`·`ActionLog`, Task 2·3
- Produces: `<OutboxSection service now />`

- [ ] **Step 1: 섹션 작성**

`apps/admin-web/src/features/events/failures/components/outbox-section.tsx`:

```tsx
'use client';

import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { EventFailureService } from '@/lib/api/domains/events';
import {
  useDiscardOutbox,
  useEventFailureSummary,
  useOutboxFailureDetail,
  useOutboxFailures,
  useResendAllOutbox,
  useResendOutbox,
} from '@/lib/services/events';
import {
  dwellSince,
  errorMessageOf,
  errorOneLine,
  loadErrorText,
  resendAllConfirmText,
  resendAllResultText,
  resendResultText,
  statusLabel,
} from '../display';
import { ConfirmAllDialog } from './confirm-all-dialog';
import { DiscardDialog, type DiscardTarget } from './discard-dialog';
import { ActionLog, ErrorBlock, Fields, JsonBlock } from './detail-parts';

interface SectionProps {
  service: EventFailureService;
  now: Date;
}

export function OutboxSection({ service, now }: SectionProps) {
  const list = useOutboxFailures(service);
  const summary = useEventFailureSummary(service);
  const resend = useResendOutbox(service);
  const discard = useDiscardOutbox(service);
  const resendAll = useResendAllOutbox(service);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const onResend = (id: number) =>
    resend.mutate(id, {
      onSuccess: (r) => {
        if (r.status === 'PUBLISHED') toast.success(resendResultText(r));
        else toast.error(resendResultText(r));
      },
      onError: (e) => toast.error(errorMessageOf(e)),
    });

  const onDiscard = (reason: string) => {
    if (!discardTarget) return;
    discard.mutate(
      { id: discardTarget.id, reason },
      {
        onSuccess: () => {
          setDiscardTarget(null);
          toast.success('종결');
        },
        onError: (e) => toast.error(errorMessageOf(e)),
      }
    );
  };

  const onResendAll = () =>
    resendAll.mutate(undefined, {
      onSuccess: (r) => {
        if (r.failed.length > 0) toast.error(resendAllResultText(r));
        else toast.success(resendAllResultText(r));
      },
      onError: (e) => toast.error(errorMessageOf(e)),
    });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">보내다 실패</h2>
        {items.length > 0 && (
          <Button size="sm" variant="outline" disabled={resendAll.isPending} onClick={() => setConfirmAll(true)}>
            전체 다시 보내기
          </Button>
        )}
      </div>

      {list.isError ? (
        <p className="text-sm text-red-600">{loadErrorText(list.error)}</p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">실패 없음</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-48" />
            <col className="w-56" />
            <col className="w-24" />
            <col />
            <col className="w-16" />
            <col className="w-44" />
          </colgroup>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">이벤트</th>
              <th>순서 키</th>
              <th>체류</th>
              <th>오류</th>
              <th>뒤 대기</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className="cursor-pointer border-t hover:bg-muted/40"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <td className="truncate py-1.5" title={item.topic}>
                    {item.eventType}
                  </td>
                  <td className="truncate font-mono text-xs">{item.aggregateId}</td>
                  <td>{dwellSince(item.failedAt ?? item.createdAt, now)}</td>
                  <td className="truncate" title={item.errorMessage ?? undefined}>
                    {errorOneLine(null, item.errorMessage)}
                  </td>
                  <td>{item.waitingBehind > 0 ? item.waitingBehind : ''}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resend.isPending && resend.variables === item.id}
                      onClick={() => onResend(item.id)}
                    >
                      다시 보내기
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDiscardTarget({
                          id: item.id,
                          label: `${item.eventType} · ${item.aggregateId}`,
                          behind: item.waitingBehind,
                        })
                      }
                    >
                      종결
                    </Button>
                  </td>
                </tr>
                {expanded === item.id && (
                  <tr>
                    <td colSpan={6} className="pb-3">
                      <OutboxDetailView service={service} id={item.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {list.hasNextPage && (
        <Button size="sm" variant="ghost" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          더 보기
        </Button>
      )}

      <DiscardDialog
        target={discardTarget}
        pending={discard.isPending}
        onClose={() => setDiscardTarget(null)}
        onSubmit={onDiscard}
      />
      <ConfirmAllDialog
        open={confirmAll}
        title="전체 다시 보내기"
        description={resendAllConfirmText(summary.data)}
        pending={resendAll.isPending}
        onOpenChange={setConfirmAll}
        onConfirm={onResendAll}
      />
    </section>
  );
}

function OutboxDetailView({ service, id }: { service: EventFailureService; id: number }) {
  const detail = useOutboxFailureDetail(service, id);
  if (detail.isError) return <p className="text-sm text-red-600">{loadErrorText(detail.error)}</p>;
  if (!detail.data) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  const d = detail.data;

  return (
    <div className="flex flex-col gap-3 rounded bg-muted/30 p-3">
      <Fields
        rows={[
          ['토픽', d.topic],
          ['상태', statusLabel(d.status)],
          ['적재', new Date(d.createdAt).toLocaleString('ko-KR')],
          ['재시도', d.retryCount],
        ]}
      />
      {d.errorMessage && <ErrorBlock text={d.errorMessage} />}
      <JsonBlock value={d.payload} />
      <ActionLog kind="outbox" actions={d.actions} />
    </div>
  );
}
```

`statusLabel('FAILED')` 는 모르는 값이라 그대로 `FAILED` 를 보인다 — outbox 상태는 대문자 어휘라 그대로 두는 편이 정확하다.

- [ ] **Step 2: 타입 검사**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/src/features/events/failures/components/outbox-section.tsx
git commit -m "feat(admin-web): 이벤트 실패 «보내다 실패» 목록 (#1016 7번)"
```

---

### Task 6: 페이지·탭·메뉴·브레드크럼

**Files:**
- Create: `apps/admin-web/src/features/events/failures/template/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/events/failures/page.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (주문/출고관리 › `stall-board` 항목 바로 뒤)
- Modify: `apps/admin-web/src/lib/utils/menu.spec.ts`
- Modify: `apps/admin-web/src/components/common/breadcrumb-items.ts` (이벤트 추적 분기 뒤)

**Interfaces:**
- Consumes: Task 4 `DeadLetterSection`, Task 5 `OutboxSection`, Task 3 `useEventFailureSummary`, Task 2 `tabBadgeCount`, Task 1 `EVENT_FAILURE_SERVICES`
- Produces: 라우트 `/events/failures`, 메뉴 id `event-failures`

- [ ] **Step 1: 메뉴 위치 테스트 작성(실패)**

`apps/admin-web/src/lib/utils/menu.spec.ts` 의 `describe('admin menu navigation', …)` 안 마지막에 덧붙인다:

```ts
  it('이벤트 실패는 주문/출고관리의 정체 보드 바로 아래에 있고 admin·master 만 본다', () => {
    const order = getMenuById('order-shipment');
    const ids = order?.children.map((item) => item.id) ?? [];

    expect(ids.indexOf('event-failures')).toBe(ids.indexOf('stall-board') + 1);
    expect(order?.children.find((item) => item.id === 'event-failures')).toMatchObject({
      title: '이벤트 실패',
      path: '/events/failures',
      requireRole: ['admin', 'master'],
    });
    expect(getActiveMenuAndItem('/events/failures')).toEqual({
      menuId: 'order-shipment',
      itemId: 'event-failures',
    });
  });
```

Run: `npm run test:admin-web -- apps/admin-web/src/lib/utils/menu.spec.ts`
Expected: FAIL — `ids.indexOf('event-failures')` 가 -1

- [ ] **Step 2: 메뉴 추가**

`apps/admin-web/src/lib/utils/menu.ts` 의 `stall-board` 항목 바로 뒤에 넣는다:

```ts
      {
        id: 'stall-board',
        title: '정체 보드',
        path: '/order/stall-board',
      },
      {
        // 주문 경로 양 끝(core·channel-adapter)의 메시지 실패 (#1016 7·8번). 페이지가 admin·master 전용이다.
        id: 'event-failures',
        title: '이벤트 실패',
        path: '/events/failures',
        requireRole: ['admin', 'master'],
      },
```

- [ ] **Step 3: 통과 확인**

Run: `npm run test:admin-web -- apps/admin-web/src/lib/utils/menu.spec.ts`
Expected: PASS

- [ ] **Step 4: 브레드크럼**

`apps/admin-web/src/components/common/breadcrumb-items.ts` 의 `} else if (pathname === '/events/trace') { … }` 블록 바로 뒤에 이어 붙인다:

```ts
  } else if (pathname === '/events/failures') {
    items.push({ label: '주문/출고관리' });
    items.push({ label: '이벤트 실패' });
  }
```

(원래의 닫는 `}` 를 이 블록의 닫는 `}` 로 바꾸는 것이다 — 결과적으로 `else if` 사슬에 분기가 하나 늘어난다.)

- [ ] **Step 5: 템플릿**

`apps/admin-web/src/features/events/failures/template/index.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EVENT_FAILURE_SERVICES, type EventFailureService } from '@/lib/api/domains/events';
import { useEventFailureSummary } from '@/lib/services/events';
import { tabBadgeCount } from '../display';
import { DeadLetterSection } from '../components/dead-letter-section';
import { OutboxSection } from '../components/outbox-section';

export default function EventFailuresTemplate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="text-xl font-bold">이벤트 실패</h1>
      <Tabs defaultValue={EVENT_FAILURE_SERVICES[0]}>
        <TabsList>
          {EVENT_FAILURE_SERVICES.map((service) => (
            <ServiceTab key={service} service={service} />
          ))}
        </TabsList>
        {EVENT_FAILURE_SERVICES.map((service) => (
          <TabsContent key={service} value={service} className="mt-4 flex flex-col gap-8">
            <DeadLetterSection service={service} now={now} />
            <OutboxSection service={service} now={now} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** 배지는 안 푼 건수가 있을 때만. 요약을 못 읽으면 «오류» — 0 으로 보이면 정상으로 오독한다 */
function ServiceTab({ service }: { service: EventFailureService }) {
  const summary = useEventFailureSummary(service);
  const count = tabBadgeCount(summary.data);
  return (
    <TabsTrigger value={service} className="gap-1.5">
      {service}
      {summary.isError ? (
        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">오류</span>
      ) : count ? (
        <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
          {count.toLocaleString()}
        </span>
      ) : null}
    </TabsTrigger>
  );
}
```

- [ ] **Step 6: 페이지**

`apps/admin-web/src/app/(admin)/events/failures/page.tsx`:

```tsx
import RouteGuard from '@/components/layout/route-guard';
import EventFailuresTemplate from '@/features/events/failures/template';

export default function EventFailuresPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <EventFailuresTemplate />
    </RouteGuard>
  );
}
```

- [ ] **Step 7: 타입 검사와 admin-web 테스트**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0

Run: `npm run test:admin-web`
Expected: 실패 0

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/features/events/failures/template/ "apps/admin-web/src/app/(admin)/events/failures/" apps/admin-web/src/lib/utils/menu.ts apps/admin-web/src/lib/utils/menu.spec.ts apps/admin-web/src/components/common/breadcrumb-items.ts
git commit -m "feat(admin-web): 이벤트 실패 페이지 /events/failures 와 메뉴 (#1016 7·8번)"
```

---

### Task 7: 게이트·수동 확인·PR

**Files:** 없음(검증·PR)

- [ ] **Step 1: 세 게이트**

Run: `cd apps/admin-web && npx tsc --noEmit` → 에러 0
Run: `npm run test:admin-web` → 실패 0
Run: `npx jest --maxWorkers=2` (루트) → 실패 0
Run: `cd apps/admin-web && npx eslint src/features/events/failures src/lib/services/events src/lib/api/domains/events "src/app/(admin)/events/failures"` → 에러 0 (admin-web 의 `eslint.config.mjs` 를 따른다)

- [ ] **Step 2: 수동 확인(로컬 E2E 가 떠 있을 때만)**

로컬 스택(`npm run start:all:local`)이 떠 있으면 브라우저에서 `/events/failures` 를 연다. 로그인은 사람이 한다.
- 두 탭이 뜨고, 실패가 없으면 각 목록에 «실패 없음» 한 줄
- core 를 마이그 없이 띄운 상태라면 그 탭만 빨간 한 줄, 다른 탭은 정상
- 메뉴 «주문/출고관리 › 이벤트 실패» 가 정체 보드 아래에 있다

로컬 스택이 없으면 이 단계는 건너뛰고 PR 본문에 «화면 수동 확인 미실행»으로 적는다.

- [ ] **Step 3: PR**

```bash
git push -u origin feat/1016-event-failure-exits-pr2
gh pr create --base develop --title "feat(admin-web): 이벤트 실패 출구 화면 (#1016 7·8번, PR 2)" --body-file <작성한 본문>
```

본문: 요약(무엇을·어디에), 결정(경로·메뉴·확인 UX — 스펙 머리 블록 링크), 테스트(게이트 결과, 수동 확인 여부), **배포** — «PR 1 의 core·channel-adapter `db:migrate → sst deploy` 뒤에 admin-web 배포. 먼저 나가도 화면은 그 탭에 오류 한 줄을 보일 뿐 다른 데 영향 없다».

---

## 머지 뒤 (사용자 지시)

1. #1016 본문 «남은 운영 작업»에 7·8번 배포 체크박스가 있는지 본다. 없으면 PR 1(#1081) 본문 «배포» 절을 기준으로 단다. **코드에서 도출되는 수치는 적지 않는다**(CLAUDE.md «이슈 본문»)
2. #1016 7·8번 행의 «해결» 칸에 PR 1(`2b7b9e9bd`)·PR 2 머지 해시를 적는다
