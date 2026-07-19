# 운송장(Waybill) 발급 화면 admin-web 배선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin-web에서 물류 담당자가 운송장을 단건 발급/수동등록/재발급/무효화하고, 전용 페이지에서 일괄 발급할 수 있도록 백엔드 waybill 모듈을 프론트에 배선한다.

**Architecture:** 기존 3층 패턴(axios client → React Query 훅 → feature 컴포넌트)을 그대로 따른다. 순수 로직(API client, 상태/carrier 정책)은 `.ts`로 분리해 jest 유닛테스트하고, UI(.tsx)는 `build:admin-web` 타입체크+빌드와 수동 확인으로 검증한다(레포 jest는 node env·`.ts`만 실행하므로 컴포넌트 유닛테스트 미지원).

**Tech Stack:** Next.js(App Router), TypeScript, @tanstack/react-query, axios, jest(ts-jest, node env), shadcn/ui 컴포넌트.

## Global Constraints

- 백엔드 변경 금지. 물리 라벨 출력·`labelData` 노출은 범위 외.
- 발급/수동/재발급/일괄 = `fulfillment.warehouse.operate` 스코프. 무효화(void) = `fulfillment.shipment.reopen` 스코프. 프론트 스코프 상수는 `lib/services/orders/operation-policy.ts`의 `FULFILLMENT_SCOPES`(이미 `operate`·`reopen` 존재).
- 발급/수동/재발급/일괄/무효화 요청은 모두 `Idempotency-Key` 헤더 필수. 키 생성은 `commandKey()`(mutations.ts) 또는 `createIdempotentCommand()`(idempotency.ts) 사용.
- carrier enum: `CJ, HANJIN, LOTTE, LOGEN, KDEXP, CJGLS`. **게이트웨이 구현은 HANJIN 단독** — 발급 UI는 HANJIN만 활성, 기본값 HANJIN.
- 발급 상태머신: `pending → allocated → registered → used`(+`failed`,`abandoned`,`voided`). **`registered`/`used`만 발급 성공.** 비종결(`pending`/`allocated`) 응답은 성공으로 표시하지 않고 동일 키 안전 재시도 + 활성 운송장 폴링으로 종결 확인.
- API base URL 상수: `ALMONDYOUNG_API_BASE_URL`(`@/const`). 커밋 트레일러: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Waybill 타입 + API 클라이언트

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/fulfillment.ts` (waybill 요청/응답 타입 추가)
- Create: `apps/admin-web/src/lib/api/domains/orders/waybills.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/index.ts` (barrel + `orders.waybills`)
- Test: `apps/admin-web/src/lib/api/domains/orders/waybills.client.spec.ts`

**Interfaces:**
- Produces: `waybillsClient.{ issue, manual, reissue, batch, void, getActive }`, `orders.waybills`
- Produces types: `CarrierCode`, `WaybillResponse`, `BatchResultItem`, `IssueWaybillRequest`, `RegisterManualWaybillRequest`, `IssueBatchWaybillRequest`, `VoidWaybillRequest`

- [ ] **Step 1: Waybill 타입 추가**

`apps/admin-web/src/lib/types/dto/fulfillment.ts` 맨 끝에 추가:

```ts
export type CarrierCode = 'CJ' | 'HANJIN' | 'LOTTE' | 'LOGEN' | 'KDEXP' | 'CJGLS';

export interface WaybillResponse {
  id: string;
  shipmentId: string;
  source: 'carrier' | 'manual' | string;
  carrier: string;
  status: string;
  trackingNo: string | null;
  custOrdNo: string | null;
  manifestVersion: number;
  issuedAt: string | null;
  voidedAt: string | null;
  lastError: string | null;
}

export interface IssueWaybillRequest {
  carrier: CarrierCode;
  expectedManifestVersion: number;
}

export interface RegisterManualWaybillRequest {
  carrier: CarrierCode;
  expectedManifestVersion: number;
  trackingNo: string;
  reason?: string;
}

export interface IssueBatchWaybillRequest {
  shipmentIds: string[];
  carrier: CarrierCode;
}

export interface VoidWaybillRequest {
  reason: string;
}

export interface BatchResultItem {
  shipmentId: string;
  status: string; // registered | failed | pending | allocated
  trackingNo: string | null;
  reason: string | null;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`apps/admin-web/src/lib/api/domains/orders/waybills.client.spec.ts`:

```ts
jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});
jest.mock('../../client', () => ({
  client: { get: jest.fn(), post: jest.fn() },
}));

import { client } from '../../client';
import { waybillsClient } from './waybills.client';

const KEY = '4e8e3b7f-37df-41fb-a084-47915ba7b6cf';
const config = { headers: { 'Idempotency-Key': KEY } };
const mocked = client as unknown as { get: jest.Mock; post: jest.Mock };

describe('waybillsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: {} });
  });

  it('issues, manual-registers and reissues with idempotency header', async () => {
    await waybillsClient.issue(
      's/1',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      KEY
    );
    await waybillsClient.manual(
      's/1',
      {
        carrier: 'HANJIN',
        expectedManifestVersion: 2,
        trackingNo: '1234',
        reason: 'x',
      },
      KEY
    );
    await waybillsClient.reissue(
      's/1',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      KEY
    );

    expect(mocked.post).toHaveBeenNthCalledWith(
      1,
      '/core/shipments/s%2F1/waybills',
      { carrier: 'HANJIN', expectedManifestVersion: 2 },
      config
    );
    expect(mocked.post).toHaveBeenNthCalledWith(
      2,
      '/core/shipments/s%2F1/waybills/manual',
      expect.objectContaining({ trackingNo: '1234' }),
      config
    );
    expect(mocked.post).toHaveBeenNthCalledWith(
      3,
      '/core/shipments/s%2F1/waybills/reissue',
      expect.any(Object),
      config
    );
  });

  it('batch-issues and voids and reads active waybill', async () => {
    await waybillsClient.batch(
      { shipmentIds: ['a', 'b'], carrier: 'HANJIN' },
      KEY
    );
    await waybillsClient.void('w/1', { reason: 'mistake' }, KEY);
    await waybillsClient.getActive('s-1');

    expect(mocked.post).toHaveBeenNthCalledWith(
      1,
      '/core/waybills:batch',
      { shipmentIds: ['a', 'b'], carrier: 'HANJIN' },
      config
    );
    expect(mocked.post).toHaveBeenNthCalledWith(
      2,
      '/core/waybills/w%2F1/void',
      { reason: 'mistake' },
      config
    );
    expect(mocked.get).toHaveBeenCalledWith('/core/shipments/s-1/waybill');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx jest apps/admin-web/src/lib/api/domains/orders/waybills.client.spec.ts`
Expected: FAIL — `Cannot find module './waybills.client'`

- [ ] **Step 4: 클라이언트 구현**

`apps/admin-web/src/lib/api/domains/orders/waybills.client.ts`:

```ts
'use client';

// src/lib/api/domains/orders/waybills.client.ts
// Core waybill(운송장) 발급 계열 엔드포인트 클라이언트.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  WaybillResponse,
  BatchResultItem,
  IssueWaybillRequest,
  RegisterManualWaybillRequest,
  IssueBatchWaybillRequest,
  VoidWaybillRequest,
} from '@/lib/types/dto/fulfillment';

const BASE = ALMONDYOUNG_API_BASE_URL;
const idem = (idempotencyKey: string) => ({
  headers: { 'Idempotency-Key': idempotencyKey },
});

export const waybillsClient = {
  issue: async (
    shipmentId: string,
    data: IssueWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybills`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  manual: async (
    shipmentId: string,
    data: RegisterManualWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybills/manual`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  reissue: async (
    shipmentId: string,
    data: IssueWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybills/reissue`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  batch: async (
    data: IssueBatchWaybillRequest,
    idempotencyKey: string
  ): Promise<BatchResultItem[]> => {
    const res = await client.post(`${BASE}/waybills:batch`, data, idem(idempotencyKey));
    return res.data;
  },

  void: async (
    waybillId: string,
    data: VoidWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/waybills/${encodeURIComponent(waybillId)}/void`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  getActive: async (shipmentId: string): Promise<WaybillResponse> => {
    const res = await client.get(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybill`
    );
    return res.data;
  },
};
```

- [ ] **Step 5: barrel 등록**

`apps/admin-web/src/lib/api/domains/orders/index.ts` 수정:
- 상단 import 목록에 추가: `import { waybillsClient } from './waybills.client';`
- `export const orders = { ... }` 객체에 `waybills: waybillsClient,` 추가.
- 파일 하단 named export 목록에 추가: `export { waybillsClient } from './waybills.client';`

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx jest apps/admin-web/src/lib/api/domains/orders/waybills.client.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/fulfillment.ts \
        apps/admin-web/src/lib/api/domains/orders/waybills.client.ts \
        apps/admin-web/src/lib/api/domains/orders/waybills.client.spec.ts \
        apps/admin-web/src/lib/api/domains/orders/index.ts
git commit -m "feat(admin-web): waybill 발급 API 클라이언트 + 타입

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Waybill 상태/carrier 정책 (순수 로직)

**Files:**
- Create: `apps/admin-web/src/lib/services/orders/waybill-policy.ts`
- Test: `apps/admin-web/src/lib/services/orders/waybill-policy.spec.ts`

**Interfaces:**
- Produces: `WAYBILL_CARRIERS`, `WAYBILL_LIVE_CARRIERS`, `isCarrierSupported(carrier)`, `isWaybillIssued(status)`, `isWaybillPendingIssue(status)`, `isWaybillFailed(status)`

- [ ] **Step 1: 실패 테스트 작성**

`apps/admin-web/src/lib/services/orders/waybill-policy.spec.ts`:

```ts
import {
  isCarrierSupported,
  isWaybillIssued,
  isWaybillPendingIssue,
  isWaybillFailed,
  WAYBILL_CARRIERS,
  WAYBILL_LIVE_CARRIERS,
} from './waybill-policy';

describe('waybill-policy', () => {
  it('lists all enum carriers but only HANJIN is live', () => {
    expect(WAYBILL_CARRIERS).toEqual([
      'CJ',
      'HANJIN',
      'LOTTE',
      'LOGEN',
      'KDEXP',
      'CJGLS',
    ]);
    expect(WAYBILL_LIVE_CARRIERS).toEqual(['HANJIN']);
    expect(isCarrierSupported('HANJIN')).toBe(true);
    expect(isCarrierSupported('CJ')).toBe(false);
  });

  it('treats only registered/used as issued', () => {
    expect(isWaybillIssued('registered')).toBe(true);
    expect(isWaybillIssued('used')).toBe(true);
    expect(isWaybillIssued('allocated')).toBe(false);
    expect(isWaybillIssued('pending')).toBe(false);
    expect(isWaybillIssued(null)).toBe(false);
  });

  it('classifies pending and failed states', () => {
    expect(isWaybillPendingIssue('pending')).toBe(true);
    expect(isWaybillPendingIssue('allocated')).toBe(true);
    expect(isWaybillPendingIssue('registered')).toBe(false);
    expect(isWaybillFailed('failed')).toBe(true);
    expect(isWaybillFailed('abandoned')).toBe(true);
    expect(isWaybillFailed('pending')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/admin-web/src/lib/services/orders/waybill-policy.spec.ts`
Expected: FAIL — `Cannot find module './waybill-policy'`

- [ ] **Step 3: 정책 구현**

`apps/admin-web/src/lib/services/orders/waybill-policy.ts`:

```ts
// src/lib/services/orders/waybill-policy.ts
// 운송장 상태/carrier UI 정책 (순수). Core 가 실제 권한/전이 경계다.

export const WAYBILL_CARRIERS = [
  'CJ',
  'HANJIN',
  'LOTTE',
  'LOGEN',
  'KDEXP',
  'CJGLS',
] as const;

// 게이트웨이가 실제 구현된 carrier 만 발급 UI 에서 활성.
export const WAYBILL_LIVE_CARRIERS = ['HANJIN'] as const;

export function isCarrierSupported(carrier: string): boolean {
  return (WAYBILL_LIVE_CARRIERS as readonly string[]).includes(carrier);
}

// registered/used 만 운송장번호 확보(발급 성공).
export function isWaybillIssued(status: string | null | undefined): boolean {
  return status === 'registered' || status === 'used';
}

// 비종결 — 성공으로 표시 금지, 동일 키 재구동/폴링 대상.
export function isWaybillPendingIssue(
  status: string | null | undefined
): boolean {
  return status === 'pending' || status === 'allocated';
}

export function isWaybillFailed(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'abandoned';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/admin-web/src/lib/services/orders/waybill-policy.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/services/orders/waybill-policy.ts \
        apps/admin-web/src/lib/services/orders/waybill-policy.spec.ts
git commit -m "feat(admin-web): waybill 상태/carrier 정책 헬퍼

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: React Query 훅 (mutations + query) + 배럴

**Files:**
- Modify: `apps/admin-web/src/lib/services/orders/query-keys.ts` (`activeWaybill` 키)
- Modify: `apps/admin-web/src/lib/services/orders/queries.ts` (`useActiveWaybill`)
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts` (발급 5종 훅)
- Modify: `apps/admin-web/src/lib/services/orders/index.ts` (export)

**Interfaces:**
- Consumes: `orders.waybills.*`(Task 1), `commandKey`, `invalidateShipment`(mutations.ts 기존 헬퍼)
- Produces: `useIssueWaybill`, `useRegisterManualWaybill`, `useReissueWaybill`, `useVoidWaybill`, `useBatchIssueWaybills`, `useActiveWaybill`, `orderQueryKeys.activeWaybill`

- [ ] **Step 1: query key 추가**

`apps/admin-web/src/lib/services/orders/query-keys.ts`의 `orderQueryKeys` 객체에서 `shipment:` 항목 바로 아래에 추가:

```ts
  activeWaybill: (shipmentId: string) =>
    ['shipments', shipmentId, 'waybill'] as const,
```

- [ ] **Step 2: query 훅 추가**

`apps/admin-web/src/lib/services/orders/queries.ts`에 `useActiveWaybill` 추가(기존 `useShipmentDetail` 근처, 동일 import 스타일 사용 — `useQuery`, `orderQueryKeys`, `orders` 는 이미 import 되어 있음):

```ts
// 활성 운송장 조회 — 발급 후 종결 상태(registered/used) 확인 폴링용.
export const useActiveWaybill = (shipmentId: string, enabled = true) =>
  useQuery({
    queryKey: orderQueryKeys.activeWaybill(shipmentId),
    queryFn: () => orders.waybills.getActive(shipmentId),
    enabled: enabled && !!shipmentId,
  });
```

- [ ] **Step 3: mutation 훅 추가**

`apps/admin-web/src/lib/services/orders/mutations.ts` 상단 `import type { ... }` 블록에 추가:

```ts
  IssueWaybillRequest,
  RegisterManualWaybillRequest,
  IssueBatchWaybillRequest,
  VoidWaybillRequest,
```

같은 파일 하단(다른 shipment 훅들 뒤)에 추가:

```ts
export const useIssueWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: IssueWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.issue(shipmentId, data, commandKey(idempotencyKey)),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};

export const useRegisterManualWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: RegisterManualWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.manual(shipmentId, data, commandKey(idempotencyKey)),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};

export const useReissueWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      data,
      idempotencyKey,
    }: {
      shipmentId: string;
      data: IssueWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.reissue(shipmentId, data, commandKey(idempotencyKey)),
    onSuccess: (_, { shipmentId }) =>
      invalidateShipment(queryClient, shipmentId),
  });
};

export const useVoidWaybill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      waybillId,
      data,
      idempotencyKey,
    }: {
      waybillId: string;
      shipmentId?: string;
      data: VoidWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.void(waybillId, data, commandKey(idempotencyKey)),
    onSuccess: (_, vars) => {
      if (vars.shipmentId) invalidateShipment(queryClient, vars.shipmentId);
    },
  });
};

export const useBatchIssueWaybills = () =>
  useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: IssueBatchWaybillRequest;
      idempotencyKey?: string;
    }) => orders.waybills.batch(data, commandKey(idempotencyKey)),
  });
```

- [ ] **Step 4: index 재노출**

`apps/admin-web/src/lib/services/orders/index.ts`:
- query 훅 export 목록(`export { ... } from './queries'` 또는 해당 블록)에 `useActiveWaybill` 추가.
- mutation 훅 export 목록에 `useIssueWaybill, useRegisterManualWaybill, useReissueWaybill, useVoidWaybill, useBatchIssueWaybills` 추가.
- `export * from './waybill-policy';` 한 줄 추가(Task 2 정책 재노출).

- [ ] **Step 5: 타입체크로 배선 검증**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: waybill 관련 신규 심볼에 대한 에러 없음(기존 repo 상시 debt 는 무시 — 변경 파일 신규 error 만 스코프).

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/lib/services/orders/query-keys.ts \
        apps/admin-web/src/lib/services/orders/queries.ts \
        apps/admin-web/src/lib/services/orders/mutations.ts \
        apps/admin-web/src/lib/services/orders/index.ts
git commit -m "feat(admin-web): waybill 발급 React Query 훅

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 단건 인라인 액션 컴포넌트 + shipment 탭 마운트

**Files:**
- Create: `apps/admin-web/src/features/order/fulfillments/detail/waybill-actions.tsx`
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx` (컴포넌트 마운트)

**Interfaces:**
- Consumes: `useIssueWaybill`, `useRegisterManualWaybill`, `useReissueWaybill`, `useVoidWaybill`, `useActiveWaybill`, `FULFILLMENT_SCOPES`, `getServerDenyMessage`, `createIdempotentCommand`, `isWaybillIssued`, `isWaybillPendingIssue`, `WAYBILL_CARRIERS`, `isCarrierSupported`(Task 2·3), `usePermission`(`@/hooks/use-permission`), `ShipmentAdminDetail`, `ShipmentWaybillHistory`
- Produces: `WaybillActions({ shipment })`

- [ ] **Step 1: 컴포넌트 작성**

`apps/admin-web/src/features/order/fulfillments/detail/waybill-actions.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePermission } from '@/hooks/use-permission';
import {
  createIdempotentCommand,
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  isWaybillIssued,
  isWaybillPendingIssue,
  useIssueWaybill,
  useReissueWaybill,
  useRegisterManualWaybill,
  useVoidWaybill,
  WAYBILL_CARRIERS,
  isCarrierSupported,
} from '@/lib/services/orders';
import type {
  CarrierCode,
  ShipmentAdminDetail,
  ShipmentWaybillHistory,
} from '@/lib/types/dto/fulfillment';

type Action = 'issue' | 'manual' | 'reissue' | 'void';

const ACTION_TITLE: Record<Action, string> = {
  issue: '운송장 발급',
  manual: '수동 운송장 등록',
  reissue: '운송장 재발급',
  void: '운송장 무효화',
};

function activeVoidableWaybill(
  waybills: ShipmentWaybillHistory[]
): ShipmentWaybillHistory | undefined {
  // 발송 전(voidedAt 없음)만 무효화 대상.
  return waybills.find((w) => !w.voidedAt && w.status !== 'voided');
}

export function WaybillActions({
  shipment,
}: {
  shipment: ShipmentAdminDetail;
}) {
  const { hasScope, isPermissionLoading } = usePermission();
  const issue = useIssueWaybill();
  const manual = useRegisterManualWaybill();
  const reissue = useReissueWaybill();
  const voidWaybill = useVoidWaybill();

  const [action, setAction] = useState<Action | null>(null);
  const [carrier, setCarrier] = useState<CarrierCode>('HANJIN');
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState('');
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  const operate =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);
  const reopen =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.reopen]);
  const voidTarget = activeVoidableWaybill(shipment.waybills ?? []);

  const busy =
    issue.isPending ||
    manual.isPending ||
    reissue.isPending ||
    voidWaybill.isPending;

  const openIssue = () => {
    setCarrier('HANJIN');
    setTrackingNo('');
    setReason('');
    setLastKey(null);
    setPendingNotice(null);
    setAction('issue');
  };

  const reflectStatus = (status: string | null | undefined) => {
    if (isWaybillIssued(status)) {
      toast.success(`운송장 발급 완료 (${status}).`);
      setPendingNotice(null);
      setAction(null);
    } else if (isWaybillPendingIssue(status)) {
      // 비종결 — 성공으로 표시하지 않는다. 동일 키 안전 재시도 안내.
      setPendingNotice(
        `발급이 아직 종결되지 않았습니다 (${status}). 동일 키로 안전하게 재시도할 수 있습니다.`
      );
      toast.info('발급 진행 중입니다. 서버 종결 전에는 성공으로 표시하지 않습니다.');
    } else {
      toast.error(`발급 실패 상태 (${status ?? 'unknown'}).`);
      setPendingNotice(null);
    }
  };

  const runIssueLike = async (kind: 'issue' | 'reissue', originalKey?: string) => {
    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');
      return;
    }
    const key = createIdempotentCommand({}, originalKey ?? undefined)
      .idempotencyKey;
    setLastKey(key);
    try {
      const data = {
        carrier,
        expectedManifestVersion: shipment.manifestVersion,
      };
      const result =
        kind === 'issue'
          ? await issue.mutateAsync({ shipmentId: shipment.id, data, idempotencyKey: key })
          : await reissue.mutateAsync({ shipmentId: shipment.id, data, idempotencyKey: key });
      reflectStatus(result.status);
    } catch (error) {
      toast.error(
        getServerDenyMessage(error, `${ACTION_TITLE[kind === 'issue' ? 'issue' : 'reissue']} 요청 실패`)
      );
    }
  };

  const runManual = async () => {
    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');
      return;
    }
    if (!trackingNo.trim()) {
      toast.error('운송장 번호를 입력하세요.');
      return;
    }
    const key = createIdempotentCommand({}).idempotencyKey;
    try {
      const result = await manual.mutateAsync({
        shipmentId: shipment.id,
        data: {
          carrier,
          expectedManifestVersion: shipment.manifestVersion,
          trackingNo: trackingNo.trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        idempotencyKey: key,
      });
      reflectStatus(result.status);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '수동 등록 요청 실패'));
    }
  };

  const runVoid = async () => {
    if (!voidTarget) {
      toast.error('무효화할 활성 운송장이 없습니다.');
      return;
    }
    if (!reason.trim()) {
      toast.error('무효화 사유를 입력하세요.');
      return;
    }
    const key = createIdempotentCommand({}).idempotencyKey;
    try {
      await voidWaybill.mutateAsync({
        waybillId: voidTarget.id,
        shipmentId: shipment.id,
        data: { reason: reason.trim() },
        idempotencyKey: key,
      });
      toast.success('운송장을 무효화했습니다.');
      setAction(null);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '무효화 요청 실패'));
    }
  };

  const submit = () => {
    if (action === 'issue') return runIssueLike('issue');
    if (action === 'reissue') return runIssueLike('reissue');
    if (action === 'manual') return runManual();
    if (action === 'void') return runVoid();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {operate && (
          <Button size="sm" variant="outline" onClick={openIssue}>
            운송장 발급
          </Button>
        )}
        {operate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTrackingNo('');
              setReason('');
              setAction('manual');
            }}
          >
            수동 등록
          </Button>
        )}
        {operate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCarrier('HANJIN');
              setLastKey(null);
              setPendingNotice(null);
              setAction('reissue');
            }}
          >
            재발급
          </Button>
        )}
        {reopen && (
          <Button
            size="sm"
            variant="destructive"
            disabled={!voidTarget}
            onClick={() => {
              setReason('');
              setAction('void');
            }}
          >
            무효화
          </Button>
        )}
      </div>

      {pendingNotice && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{pendingNotice}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !lastKey}
              onClick={() =>
                runIssueLike(action === 'reissue' ? 'reissue' : 'issue', lastKey ?? undefined)
              }
            >
              동일 키로 안전 재시도
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={!!action} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action ? ACTION_TITLE[action] : ''}</DialogTitle>
          </DialogHeader>

          {action !== 'void' && (
            <div className="space-y-1.5">
              <Label>택배사</Label>
              <Select
                value={carrier}
                onValueChange={(v) => setCarrier(v as CarrierCode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAYBILL_CARRIERS.map((c) => (
                    <SelectItem
                      key={c}
                      value={c}
                      disabled={!isCarrierSupported(c)}
                    >
                      {c}
                      {isCarrierSupported(c) ? '' : ' (미지원)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === 'manual' && (
            <div className="space-y-1.5">
              <Label>운송장 번호</Label>
              <Input
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
            </div>
          )}

          {(action === 'manual' || action === 'void') && (
            <div className="space-y-1.5">
              <Label>사유{action === 'void' ? ' (필수)' : ' (선택)'}</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {action === 'void' && (
            <p className="text-xs text-muted-foreground">
              대상 운송장: {voidTarget ? voidTarget.trackingNo ?? voidTarget.id : '없음'}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              취소
            </Button>
            <Button
              variant={action === 'void' ? 'destructive' : 'default'}
              onClick={submit}
              disabled={busy}
            >
              {busy ? '요청 중...' : '서버에 요청'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: shipment 탭에 마운트**

`apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx` 수정:
- 상단 import 에 추가: `import { WaybillActions } from './waybill-actions';`
- "운송장 이력" 섹션 헤더(`<h3>운송장 이력 ...</h3>`) 바로 아래, 목록 위에 `<WaybillActions shipment={shipment} />` 삽입. 구체적으로 `<section>` 안의 `<h3 ...>운송장 이력 ({waybills.length})</h3>` 다음 줄에:

```tsx
        <WaybillActions shipment={shipment} />
```

- [ ] **Step 3: 빌드/타입체크**

Run: `cd apps/admin-web && npm run build`
Expected: 빌드 성공. waybill-actions.tsx·shipment-tab.tsx 관련 타입 에러 없음.

- [ ] **Step 4: 수동 확인**

Run: `npm run start:admin-web:dev` 후 FO 상세 > shipment 탭 진입.
확인: (1) operate 권한 시 발급/수동/재발급 버튼, reopen 권한 시 무효화 버튼 노출. (2) 택배사 select 에서 HANJIN 만 선택 가능. (3) 발급 클릭 → 응답 status 가 registered/used 면 성공 토스트, pending/allocated 면 성공 표시 없이 "안전 재시도" 알럿. (권한/실데이터 없으면 스코프 게이팅·버튼 노출까지만 확인)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/fulfillments/detail/waybill-actions.tsx \
        apps/admin-web/src/features/order/fulfillments/detail/shipment-tab.tsx
git commit -m "feat(admin-web): FO 상세 단건 운송장 발급/수동/재발급/무효화 액션

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 일괄 발급 큐 페이지 `/order/waybill-issue`

**Files:**
- Create: `apps/admin-web/src/app/(admin)/order/waybill-issue/page.tsx`
- Create: `apps/admin-web/src/features/order/waybill-issue/template/WaybillIssueTemplate.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (메뉴 항목)

**Interfaces:**
- Consumes: `useFulfillments`, `useFulfillmentShipments`(queries.ts 기존), `useBatchIssueWaybills`, `createIdempotentCommand`, `getServerDenyMessage`, `WAYBILL_CARRIERS`, `isCarrierSupported`, `BatchResultItem`, `CarrierCode`
- 후보 소스(범위 내 결정): 백엔드에 "waybill 필요 shipment" 목록 엔드포인트가 없고 백엔드 변경은 범위 외이므로, **FO 스코프**로 후보를 모은다 — FO 선택 → 해당 FO 의 `planned` shipment 를 체크박스로. 이미 활성 운송장이 있는 shipment 는 배치 결과표(status)가 진실원천(백엔드 멱등 처리)이다. 다중 FO 교차 선택은 후속.

- [ ] **Step 1: 템플릿 작성**

`apps/admin-web/src/features/order/waybill-issue/template/WaybillIssueTemplate.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createIdempotentCommand,
  getServerDenyMessage,
  isCarrierSupported,
  useBatchIssueWaybills,
  useFulfillmentShipments,
  useFulfillments,
  WAYBILL_CARRIERS,
} from '@/lib/services/orders';
import type { BatchResultItem, CarrierCode } from '@/lib/types/dto/fulfillment';

export default function WaybillIssueTemplate() {
  const fulfillments = useFulfillments();
  const [foId, setFoId] = useState('');
  const shipments = useFulfillmentShipments(foId);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [carrier, setCarrier] = useState<CarrierCode>('HANJIN');
  const [results, setResults] = useState<BatchResultItem[]>([]);
  const batch = useBatchIssueWaybills();

  const plannedShipments = useMemo(
    () => (shipments.data ?? []).filter((s) => s.status === 'planned'),
    [shipments.data]
  );
  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([id]) => id);

  const runBatch = async () => {
    if (!selectedIds.length) {
      toast.error('발급할 shipment 를 선택하세요.');
      return;
    }
    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');
      return;
    }
    const key = createIdempotentCommand({}).idempotencyKey;
    try {
      const res = await batch.mutateAsync({
        data: { shipmentIds: selectedIds, carrier },
        idempotencyKey: key,
      });
      setResults(res);
      const failed = res.filter((r) => r.status === 'failed').length;
      toast[failed ? 'warning' : 'success'](
        `일괄 발급 완료 — 총 ${res.length}건, 실패 ${failed}건.`
      );
    } catch (error) {
      toast.error(getServerDenyMessage(error, '일괄 발급 요청 실패'));
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold">운송장 일괄 발급</h1>
        <p className="text-sm text-muted-foreground">
          FO 를 선택하면 planned shipment 를 골라 한 번에 발급합니다.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm">주문처리(FO)</label>
          <Select value={foId} onValueChange={setFoId}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="FO 선택" />
            </SelectTrigger>
            <SelectContent>
              {(fulfillments.data ?? []).map((fo) => (
                <SelectItem key={fo.id} value={fo.id}>
                  {fo.id} · {fo.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm">택배사</label>
          <Select value={carrier} onValueChange={(v) => setCarrier(v as CarrierCode)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WAYBILL_CARRIERS.map((c) => (
                <SelectItem key={c} value={c} disabled={!isCarrierSupported(c)}>
                  {c}
                  {isCarrierSupported(c) ? '' : ' (미지원)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={runBatch} disabled={batch.isPending || !selectedIds.length}>
          {batch.isPending ? '발급 중...' : `선택 ${selectedIds.length}건 일괄발급`}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>shipment</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">수량</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plannedShipments.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Checkbox
                    checked={!!selected[s.id]}
                    onCheckedChange={(c) =>
                      setSelected((prev) => ({ ...prev, [s.id]: c === true }))
                    }
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{s.id}</TableCell>
                <TableCell>
                  <Badge variant="outline">{s.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.qty}</TableCell>
              </TableRow>
            ))}
            {foId && plannedShipments.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  planned 상태 shipment 가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">발급 결과</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>shipment</TableHead>
                  <TableHead>결과</TableHead>
                  <TableHead>운송장번호</TableHead>
                  <TableHead>사유</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.shipmentId}>
                    <TableCell className="font-mono text-xs">{r.shipmentId}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === 'failed' ? 'destructive' : 'outline'}
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.trackingNo ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.reason ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
```

확인됨: `useFulfillments()`는 무인자 호출 가능(내부 기본값 `{}`)하고 `FulfillmentOrder[]`(각 `id`·`status` 보유)를 반환한다. `useFulfillmentShipments(foId)`는 `FulfillmentShipmentSummary[]`(각 `id`·`status`·`qty` 보유)를 반환한다.

- [ ] **Step 2: 페이지 라우트 작성**

`apps/admin-web/src/app/(admin)/order/waybill-issue/page.tsx`:

```tsx
/** @format */

import RouteGuard from '@/components/layout/route-guard';
import WaybillIssueTemplate from '@/features/order/waybill-issue/template/WaybillIssueTemplate';

// 운송장 일괄 발급 페이지
export default function OrderWaybillIssuePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <WaybillIssueTemplate />
    </RouteGuard>
  );
}
```

확인됨: `RouteGuard`는 default export이며 `requireRole: string[]` prop 을 받는다(`shipment-round/page.tsx`와 동일 패턴). 위 코드 그대로 사용.

- [ ] **Step 3: 사이드바 메뉴 추가**

`apps/admin-web/src/lib/utils/menu.ts`의 `order-shipment` 섹션 `children` 배열에서 `picking-list`(id: 'picking-list', path: '/order/picking-list') 항목 근처에 동일 shape 로 추가. 확인된 항목 shape 는 `{ id, title, path }`(일부 최상위만 `icon`·`defaultPath` 보유):

```ts
{ id: 'waybill-issue', title: '운송장 발급', path: '/order/waybill-issue' },
```

- [ ] **Step 4: 빌드/타입체크**

Run: `cd apps/admin-web && npm run build`
Expected: 빌드 성공. 신규 페이지/템플릿 타입 에러 없음.

- [ ] **Step 5: 수동 확인**

Run: `npm run start:admin-web:dev` → 사이드바 "운송장 발급" → `/order/waybill-issue` 진입.
확인: (1) FO 선택 시 planned shipment 목록·체크박스, (2) 선택 후 "일괄발급" → 결과표에 shipmentId/status/trackingNo/reason 렌더, (3) 실패 항목 destructive 뱃지.

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/app/\(admin\)/order/waybill-issue/page.tsx \
        apps/admin-web/src/features/order/waybill-issue/template/WaybillIssueTemplate.tsx \
        apps/admin-web/src/lib/utils/menu.ts
git commit -m "feat(admin-web): 운송장 일괄 발급 큐 페이지

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 검증 (전체)

- [ ] `npx jest apps/admin-web/src/lib/api/domains/orders/waybills.client.spec.ts apps/admin-web/src/lib/services/orders/waybill-policy.spec.ts` — 전부 PASS.
- [ ] `cd apps/admin-web && npm run build` — 성공, 변경 파일 신규 타입 에러 0.
- [ ] 수동: FO 상세 단건 액션 4종 + 일괄 발급 페이지 동작(권한/데이터 가용 범위 내).

## 완료 정의

단건(발급·수동·재발급·무효화)과 일괄 발급이 admin-web 에서 동작하고, 비종결 발급 상태를 성공으로 오표기하지 않으며, HANJIN 만 활성 carrier 로 노출된다. 라벨 출력·백엔드 변경·다중 FO 교차 일괄선택은 범위 외(후속).
