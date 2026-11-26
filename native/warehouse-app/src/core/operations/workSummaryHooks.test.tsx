import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../data/ApiClientProvider';
import { SessionProvider } from '../../app/session-context';
import type { Session } from '../auth/session';
import type { ApiClient } from '../data/httpClient';
import {
  useCancelInbound,
  useCancelPurchaseOrderReceipt,
  usePutaway,
  useReceivePurchaseOrder,
  useSimpleInbound,
} from '../../domains/inbound/mutations';
import { useMoveStock } from '../../domains/movement/useMoveStock';
import { useAdjustStock } from '../../domains/inventory/useAdjustStock';

vi.mock('./useWorkCapabilities', () => ({
  usePermissionReader: () => async () => ({ stockAdjust: true }),
}));

type Sent = Parameters<ApiClient['request']>[0];

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'token',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

function setup() {
  const sent: Sent[] = [];
  const client: ApiClient = {
    request: async <T,>(o: Sent) => {
      sent.push(o);
      return {} as T;
    },
  };
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { sent, wrapper };
}

it('쓰기 훅은 표시 이름을 요청 옵션으로만 넘기고 서버 본문에는 싣지 않는다', async () => {
  const { sent, wrapper } = setup();
  const summary = '데모 상품 11 ×3';
  const hook = <T,>(use: () => T) =>
    renderHook(use, { wrapper }).result.current;

  await hook(useSimpleInbound).mutateAsync({
    warehouseId: 'w',
    items: [{ skuId: 's', quantity: 3 }],
    idempotencyKey: 'k1',
    summary,
  });
  await hook(usePutaway).mutateAsync({
    lineId: 'l',
    toLocationId: 'to',
    quantity: 3,
    idempotencyKey: 'k2',
    summary,
  });
  await hook(useCancelInbound).mutateAsync({
    lineId: 'l',
    quantity: 3,
    idempotencyKey: 'k3',
    summary,
  });
  await hook(useReceivePurchaseOrder).mutateAsync({
    poId: 'po',
    warehouseId: 'w',
    lines: [{ skuId: 's', quantity: 3 }],
    idempotencyKey: 'k4',
    summary,
  });
  await hook(useCancelPurchaseOrderReceipt).mutateAsync({
    receiptLineId: 'rl',
    idempotencyKey: 'k5',
    summary,
  });
  await hook(useMoveStock).mutateAsync({
    warehouseId: 'w',
    skuId: 's',
    fromLocationId: 'a',
    toLocationId: 'b',
    quantity: 3,
    idempotencyKey: 'k6',
    summary,
    screen: '/putaway',
  });
  await hook(useAdjustStock).mutateAsync({
    skuId: 's',
    warehouseId: 'w',
    locationId: 'l',
    delta: 3,
    reason: '발견',
    idempotencyKey: 'k7',
    summary,
  });

  expect(sent).toHaveLength(7);
  expect(sent[5].screen).toBe('/putaway');
  expect(sent[5].body).not.toHaveProperty('screen');
  for (const request of sent) {
    expect(request.summary).toBe(summary);
    expect(request.body).not.toHaveProperty('summary');
    expect(JSON.stringify(request.body)).not.toContain('데모 상품');
  }
});
