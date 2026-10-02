import 'fake-indexeddb/auto';
import { QueryObserver } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fetchPendingRefills } from '../../domains/outbound/refills';
import { WAREHOUSE_ID } from './__fixtures__/outboundServer';
import { openBox, press, scan, setupInspection, typeHuman } from './__fixtures__/renderStation';

const PENDING = [
  {
    shipmentId: 's-9',
    trackingNo: '421033881931',
    recipientMasked: '최*아',
    items: [
      { shipmentLineId: 'l-9', skuId: 'k-9', skuName: '퍼머넌트 1제 웨이브', sourceLocationId: 'loc-C-07-1', locationCode: 'C-07-1', qty: 1 },
    ],
  },
];

const refillRequests = (server: { requests: { path: string }[] }) =>
  server.requests.filter((r) => r.path.startsWith('/outbound-refills/pending')).length;

describe('보충 대기(스펙 §7.3)', () => {
  it('송장 대기에 창고의 보충 대기 박스를 보인다 — 송장번호·받는 분·가져올 것', async () => {
    await setupInspection({ refills: PENDING });
    const panel = await screen.findByRole('region', { name: '보충 대기' });
    expect(within(panel).getByText('4210-3388-1931')).toBeInTheDocument();
    expect(within(panel).getByText('최*아')).toBeInTheDocument();
    expect(within(panel).getByText('[C-07-1]')).toBeInTheDocument();
    expect(within(panel).getByText('퍼머넌트 1제 웨이브')).toBeInTheDocument();
  });

  it('비었으면 그리지 않는다', async () => {
    const { server } = await setupInspection();
    await waitFor(() => expect(refillRequests(server)).toBeGreaterThan(0));
    expect(screen.queryByRole('region', { name: '보충 대기' })).toBeNull();
  });

  it('조회가 실패하면(PR A 이전 core) 그리지 않는다', async () => {
    const { server } = await setupInspection({ refills: 'fail' });
    await waitFor(() => expect(refillRequests(server)).toBeGreaterThan(0));
    expect(screen.queryByRole('region', { name: '보충 대기' })).toBeNull();
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
  });

  it('결품으로 채우면 바로 다시 조회한다 — 30초를 기다리지 않는다', async () => {
    const { server, queryClient, runtime } = await setupInspection();
    // 패널은 작업 화면 동안 사라지고 돌아오면 다시 마운트된다 — 재마운트의 조회가 무효화를 대신하지 않게
    // 구독자를 따로 붙들고, 신선 시간을 무한으로 둬 마운트만으로는 조회가 안 가게 한다.
    // 이 구독자에는 주기 조회도 없어, 요청이 늘면 무효화 때문이다
    queryClient.setQueryDefaults(['outbound-refills'], { staleTime: Infinity });
    const observer = new QueryObserver(queryClient, {
      queryKey: ['outbound-refills', WAREHOUSE_ID],
      queryFn: () => fetchPendingRefills(runtime.runner, WAREHOUSE_ID),
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
      await openBox('421033881907');
      scan('8801002');
      await waitFor(() => expect(server.scans).toHaveLength(1));
      await waitFor(() => expect(screen.getByRole('button', { name: /결품/ })).toBeInTheDocument());
      server.config.refills = PENDING;
      const before = refillRequests(server);
      press('F9');
      await screen.findByRole('dialog', { name: '결품' });
      await typeHuman(['Enter', 'Enter']);
      await waitFor(() => expect(refillRequests(server)).toBeGreaterThan(before));
      await waitFor(() => expect(observer.getCurrentResult().data).toEqual(PENDING));
      expect(await screen.findByRole('region', { name: '보충 대기' })).toBeInTheDocument();
    } finally {
      unsubscribe();
    }
  });
});
