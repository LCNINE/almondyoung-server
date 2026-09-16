# 로그인 후 작업 준비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정상 로그인은 추가 확인 클릭 없이 작업을 시작하고, 실제 복구 실패·계정 변경·미확인 작업은 올바르게 차단한다.

**Architecture:** 현재 runtime 소유자와 실행 generation에 결합된 작은 readiness 훅을 만든다. WorkBoundary는 초기화 상태와 기존 업무별 operation 잠금을 합성하며, ApiClientProvider의 주체 검증과 IndexedDB runner는 유지한다.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Testing Library, fake-indexeddb, Tauri.

**Spec:** [물류 앱 시연 흐름 설계 §4, §7 A1–A4](../specs/2026-09-16-warehouse-demo-readiness-design.md)

## 실행 상태 (2026-09-16)

A/B/C-1–C-3 구현과 개별 리뷰를 완료했다. C-4 로컬 HTTP/DB·전체 gate 결과는 [통합 인수 기록](../../../native/warehouse-app/docs/warehouse-demo-readiness-acceptance.md)에 있다. 체크 표시는 각 task의 실행/RED·GREEN 기록에 근거한다. C-4 독립 리뷰·전체 branch 리뷰, 배포·실제 Windows/PDA 인수는 아직 완료 표시하지 않는다.

## Global Constraints

- Node 22와 저장소의 `corepack yarn` 명령을 사용한다. 신규 외부 의존성·DB 테이블·DB enum·영구 재고 사본을 추가하지 않는다.
- v2 작업 키·원래 요청 본문·사용자/API 범위·확정 결과 재생 계약을 유지한다. 미확인 작업을 새 키로 바꾸지 않는다.
- 입고 대기·배치 관리 재고·예약 보호, 서버 권한과 창고 범위 검증을 유지한다.
- 원장·피킹·검수·출고 변경은 호출자가 소유한 같은 트랜잭션에서 원자적으로 처리한다. GET은 조회만 한다.
- 작업자에게는 한국어 행동 안내를 제공하고, 내부 코드·잠금·DB 상태는 진단 정보로 분리한다.
- 검증은 명시적으로 지정한 전용 로컬 DB에서 수행한다. 운영 데이터 보정·운영 배포·실제 기기 인수는 자동 검사와 구분한다.

## 시작 조건과 파일 지도

구현 전 `git status --short`, `git log -5 --oneline`, 적용되는 AGENTS.md를 확인한다. 기준 develop은 `25ef604a6`이다. 구현은 `using-git-worktrees` 절차로 별도 작업공간을 확보한다. 이 계획 작성 시 제품 코드는 수정하지 않았다.

| 파일                                                                          | 책임                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| 신규 `native/warehouse-app/src/core/operations/useWorkReadiness.ts`           | owner/generation·초기화·재확인           |
| 신규 `native/warehouse-app/src/core/operations/useWorkReadiness.test.tsx`     | 상태 전이·비동기 역전 회귀               |
| 기존 `native/warehouse-app/src/core/operations/WorkBoundary.tsx`              | 상태 표시 및 작업 잠금 합성              |
| 신규 `native/warehouse-app/src/core/operations/WorkBoundary.runtime.test.tsx` | 실제 provider/runner/IndexedDB 연결 검사 |
| 기존 `native/warehouse-app/src/core/data/ApiClientProvider.test.tsx`          | 미인증 → 인증 runtime 교체 회귀          |

참고만: `ApiClientProvider.tsx`, `operationRunner.ts`, `OperationContext.tsx`, `session-context.tsx`, `Bootstrap.tsx`, `main.tsx`. 새로운 auth store나 전역 state library를 만들지 않는다.

## Task A-1: 현재 사용자에 결합된 readiness 구현

**Files:** 위 신규 hook 및 hook test.

**Interfaces:** `WorkRuntime`은 기존 OperationContext의 타입이다. 다음 public interface를 훅 파일에서 export한다.

```ts
export type WorkReadiness =
  | { status: 'signed_out' }
  | { status: 'checking_scope' }
  | { status: 'restoring'; scope: string }
  | { status: 'ready'; scope: string }
  | { status: 'failed'; step: 'scope' | 'restore' | 'retry'; message: string };
export function useWorkReadiness(
  runtime: WorkRuntime,
  authenticated: boolean,
): {
  state: WorkReadiness;
  recheck(): Promise<void>;
};
```

- [x] **1. 먼저 실패 검사 작성.** 기존 `createTestWorkRuntime`으로 실제 runner/store를 구성하고 scope/restore의 실패와 완료 시점만 제어한다. 첫 검사는 다음처럼 로그인 전 접근 금지를 검증한다.

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createTestWorkRuntime } from '../../domains/inbound/__fixtures__/workRuntime';
import { useWorkReadiness } from './useWorkReadiness';

it('로그인 전에는 검사하지 않고 로그인하면 준비한다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  const scope = vi.spyOn(runtime, 'getScope');
  const restore = vi.spyOn(runtime.runner, 'restore');
  const { result, rerender } = renderHook(({ authed }) => useWorkReadiness(runtime, authed), {
    initialProps: { authed: false },
  });
  expect(result.current.state.status).toBe('signed_out');
  expect(scope).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  act(() => rerender({ authed: true }));
  await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' }));
  expect(restore).toHaveBeenCalledTimes(1);
});
```

추가 입력표: scope reject → failed(scope), restore reject → failed(restore), recheck retry reject → failed(retry), 재확인 성공 → ready, 동시 recheck 두 번 → retryPending 한 번. deferred Promise를 사용하고 전역 timeout을 늘리지 않는다.

- [x] **2. RED 확인.** `corepack yarn --cwd native/warehouse-app test src/core/operations/useWorkReadiness.test.tsx --maxWorkers=2`. 신규 import 또는 기대 상태에서 실패해야 한다.
- [x] **3. 훅 구현.** `(runtime, authenticated)`로 owner를 생성하고, 저장한 상태의 owner와 다르면 첫 render에 ready를 반환하지 않는다. 아래 순서를 내부 단일 검사 경로로 구현한다.

```text
check(retry):
  미인증이면 signed_out 반환, I/O 없음
  현재 owner의 실행 중 Promise가 있으면 공유
  generation 캡처; checking_scope
  scope = await runtime.getScope()
  restoring(scope); await runtime.runner.restore()
  retry일 때 await runtime.runner.retryPending()
  latestScope = await runtime.getScope()
  scope != latestScope이면 failed(scope)
  owner/generation이 여전히 현재일 때만 ready(scope)
  실패 시 현재 단계의 failed 저장; finally에서 자기 Promise만 정리
```

effect cleanup은 generation을 무효화한다. 취소된 네트워크 작업의 결과를 성공/실패로 추정하지 않는다. 반환 recheck는 오류를 state로 처리하여 클릭/online에서 unhandled rejection이 생기지 않게 한다. 최초 effect는 retry=false, recheck는 retry=true를 사용한다.

- [x] **4. 계정 전환 회귀 추가.** A의 지연 scope/restore가 B의 ready 이후 resolve/reject되는 두 경우, 로그아웃 중 결과 도착, 같은 runtime 재확인 중복, React StrictMode cleanup을 검사한다. stale 완료가 B 상태를 덮거나 A pending을 B로 전송하면 실패다.
- [x] **5. GREEN 확인 후 커밋.** 위 focused 명령 통과 후 `feat(warehouse): model work readiness per authenticated runtime`으로 해당 두 파일만 커밋한다.

## Task A-2: WorkBoundary 연결과 실제 로그인 경계 검증

**Files:** `WorkBoundary.tsx`, 신규 `WorkBoundary.runtime.test.tsx`, 기존 `ApiClientProvider.test.tsx`.

**Interfaces:** A-1의 `useWorkReadiness(runtime, authed)`를 소비한다. WorkArea/useWorkAreaBlocked/ScanAllowance의 외부 호출 계약을 유지한다.

- [x] **1. 기존 현상을 정상 기대값으로 재현.** runtime test에는 `fake-indexeddb/auto`, 실제 QueryClientProvider/SessionProvider/ApiClientProvider/WorkArea를 사용한다. Tauri HTTP만 정상 work-context 응답으로 대체한다. 아래 세션 fixture를 사용해 초기 미인증 render가 안정된 뒤 로그인한다.

```tsx
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '../auth/session';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../data/ApiClientProvider';
import { WorkArea } from './WorkBoundary';

let authed = false;
const listeners = new Set<() => void>();
const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => authed,
  getAccessToken: async () => {
    if (!authed) throw new Error('not logged in');
    return 'worker-token';
  },
  login: async () => {
    authed = true;
    listeners.forEach((fn) => fn());
  },
  logout: async () => {
    authed = false;
    listeners.forEach((fn) => fn());
  },
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SessionProvider session={session}>
      <ApiClientProvider>
        <WorkArea kind="inbound">
          <button>입고 실행</button>
        </WorkArea>
      </ApiClientProvider>
    </SessionProvider>
  </QueryClientProvider>,
);
await act(async () => {});
await act(async () => {
  await session.login();
});
await waitFor(() => expect(screen.getByText('입고 실행').closest('[inert]')).toBeNull());
expect(screen.queryByText('작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.')).toBeNull();
```

mock work-context는 `{ actorId: 'worker', operationContractVersion: 2, capabilities: { inboundWorkflowConsistency: true } }`이며 성공 상태를 직접 주입하지 않는다. beforeEach/afterEach에서 기본 operation store DB를 격리/종료하여 다른 테스트의 pending을 읽지 않는다.

- [x] **2. RED 실행.** `corepack yarn --cwd native/warehouse-app test src/core/operations/WorkBoundary.runtime.test.tsx --maxWorkers=1`. 기존 구현에서 정상 로그인 후 inert/error가 남아 실패해야 한다.
- [x] **3. Boundary 통합.** 독립 `problem/restoring/scope` effects와 직접 setProblem을 제거하고 readiness를 소비한다. 기존 ops snapshot, now timer, beforeunload, 업무별 path 분류, ScanAllowance를 보존한다.

```ts
const { state, recheck } = useWorkReadiness(runtime, authed);
const ready = state.status === 'ready';
const scope = ready ? state.scope : null;
const problem = authed && state.status === 'failed';
const restoring = authed && !ready && !problem;
// AreaContext의 기존 problem/restoring을 위 값으로 공급한다.
// 수동 버튼과 online listener는 모두 recheck를 호출한다.
```

로그인 성공 자체가 pending operation 잠금을 지우지 않게 한다. provider를 Bootstrap 뒤로 옮기거나 전체 children을 재마운트하는 방식으로만 문제를 감추지 않는다.

- [x] **4. 실제 runtime 경계 검사.** 정상 bootstrap, IndexedDB 실패 뒤 재확인, scope 성공/restore 실패, uncertain 출고 보존, logout/login A→B, 연속 스캔 sending 중 허용과 uncertain 후 차단을 검사한다. A-1의 generation 검사는 runtime 교체에서도 반복한다.
- [x] **5. 집중·전체 회귀 실행.**

```bash
corepack yarn --cwd native/warehouse-app test src/core/operations src/core/data/ApiClientProvider.test.tsx src/app/Bootstrap.test.tsx src/domains/outbound/LocationOutboundScreen.runtime.test.tsx --maxWorkers=2
corepack yarn --cwd native/warehouse-app test --maxWorkers=2
corepack yarn --cwd native/warehouse-app build
corepack yarn --cwd native/warehouse-app lint
```

fail/skip/unhandled rejection 0을 확인한다. 기존 lint 경고는 기준선과 비교해 새 경고를 남기지 않는다. `fix(warehouse): unlock work after successful session recovery`로 명시한 변경 파일을 커밋한다.

## 종료와 다음 작업

A1–A4의 실제 실행 결과를 구현 PR에 기록한다. 별도 API/schema 배포는 필요 없다. 다음은 [위치 정책 계획](2026-09-16-warehouse-location-policy.md)이며, 전체 HTTP/DB 및 기기 인수는 출고 계획의 Task C-4에서 함께 수행한다.
