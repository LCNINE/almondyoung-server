/* oxlint-disable react/only-export-components -- 테스트 전용 하네스: 렌더 함수와 반품 데이터를 한 파일에서 낸다 */
import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import type { DevicePrefs } from '../../../core/data/devicePrefs';
import { createTestRuntime } from '../../outbound/__fixtures__/outboundServer';
import { renderStation, stationPrefs } from '../../outbound/__fixtures__/renderStation';
import { ReturnsScreen } from '../ReturnsScreen';
import { createReturnsServer, type FakeReturn } from './returnsServer';

/** 도착 대기 — 아직 아무것도 안 왔다. 요청이 가장 이르다(단계가 시간보다 먼저 정렬되는지 본다) */
export const AWAITING: FakeReturn = {
  reason: 'change_of_mind',
  feeBearer: 'customer',
  note: null,
  id: 'cr-1',
  orderNo: 'O-1001',
  customerName: '김민영',
  status: 'expected',
  requestedAt: '2026-10-20T01:00:00.000Z',
  lines: [
    { id: 'crl-1', productName: '컬러크림 6N', items: [{ id: 'cri-1', skuName: '컬러크림 6N', expectedQty: 2, barcodes: ['8801001'] }] },
  ],
};

/** 덜 옴 — 두 줄 중 하나만 일부 왔다 */
export const PARTIAL: FakeReturn = {
  reason: 'wrong_item',
  feeBearer: 'seller',
  note: '주문한 상품과 달라요',
  id: 'cr-2',
  orderNo: 'O-1002',
  customerName: '이서진',
  status: 'arrived',
  requestedAt: '2026-10-21T01:00:00.000Z',
  lines: [
    {
      id: 'crl-2',
      productName: '헤어클립 집게핀',
      items: [{ id: 'cri-2', skuName: '헤어클립 집게핀', expectedQty: 3, arrivedQty: 1, barcodes: ['8801002'] }],
    },
    { id: 'crl-3', productName: '샴푸 퍼퓸', items: [{ id: 'cri-3', skuName: '샴푸 퍼퓸', expectedQty: 1, barcodes: ['8801003'] }] },
  ],
};

/** 검수 대기 — 다 왔다 */
export const READY: FakeReturn = {
  reason: 'defective',
  feeBearer: 'seller',
  note: '포장이 찢어졌어요',
  id: 'cr-3',
  orderNo: 'O-1003',
  customerName: '박지훈',
  status: 'arrived',
  requestedAt: '2026-10-22T01:00:00.000Z',
  lines: [
    {
      id: 'crl-4',
      productName: '컬러크림 7N',
      items: [{ id: 'cri-4', skuName: '컬러크림 7N', expectedQty: 2, arrivedQty: 2, barcodes: ['8801004'] }],
    },
  ],
};

/** 이 창고(w-1)에 안 보이는 것들 — 다른 창고가 배송한 주문, 취소된 반품 */
export const ELSEWHERE: FakeReturn = { ...AWAITING, id: 'cr-9', orderNo: 'O-1009', deliveredBy: ['w-2'] };
export const CANCELLED: FakeReturn = { ...AWAITING, id: 'cr-8', orderNo: 'O-1008', status: 'cancelled' };

/** F7 반품을 가짜 core 위에 스테이션 셸 안에 그린다 */
export function setupReturns(opts: { returns?: FakeReturn[]; prefs?: DevicePrefs } = {}) {
  const server = createReturnsServer({ returns: opts.returns ?? [AWAITING, PARTIAL, READY, ELSEWHERE, CANCELLED] });
  const runtime = createTestRuntime(server);
  const prefs = opts.prefs ?? stationPrefs();
  const view = renderStation(() => <ReturnsScreen />, { runtime, prefs, path: '/customer-returns' });
  return { server, prefs, ...view };
}

/** 목록에 행이 그려질 때까지 — 행(주문번호)들을 돌려준다 */
export async function listed(): Promise<string[]> {
  await waitFor(() => expect(orderNos().length).toBeGreaterThan(0));
  return orderNos();
}

export const orderNos = () =>
  screen.queryAllByRole('option').map((row) => row.getAttribute('data-order-no') ?? '');
