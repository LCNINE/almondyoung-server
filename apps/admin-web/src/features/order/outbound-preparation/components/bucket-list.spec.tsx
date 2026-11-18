/** @jest-environment jsdom */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { BucketList } from './bucket-list';
import type { PreparationBucketDto } from '@/lib/types/dto/fulfillment';

jest.mock('@/lib/services/orders', () => ({
  useCreateShipmentConsolidation: jest.fn(),
  useRunOutboundPreparation: jest.fn(),
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

const shipment = (shipmentId: string, reason: string | null) => ({
  shipmentId,
  orderNos: [shipmentId.toUpperCase()],
  itemSummary: '상품',
  totalQty: 1,
  single: true,
  reason,
});

function list(bucket: PreparationBucketDto) {
  return (
    <BucketList
      bucket={bucket}
      warehouseId="w1"
      selectedIds={[]}
      busy={false}
      onToggle={jest.fn()}
      onToggleAll={jest.fn()}
      onMerge={jest.fn()}
      canPrepare
      onPrepareSeparately={jest.fn()}
    />
  );
}

it('이어서 할 상자는 송장 실패 사유와 상자 상세 링크를 보이고, 사유가 없으면 링크도 없다', () => {
  render(
    list({
      bucket: 'resume',
      count: 2,
      singleCount: 2,
      multiCount: 0,
      shipments: [
        shipment(
          's1',
          '운송사가 송장 번호를 주지 않았어요 (ERROR-01) — 상자 화면에서 확인해요'
        ),
        shipment('s2', null),
      ],
    })
  );

  expect(
    screen.getByText(
      '운송사가 송장 번호를 주지 않았어요 (ERROR-01) — 상자 화면에서 확인해요'
    )
  ).toBeTruthy();
  const links = screen.getAllByRole('link', { name: '상자 상세' });
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/order/fulfillments?shipmentId=s1',
  ]);
});

it('결품 상자, 배치에서 빠져 돌아온 상자, 그 밖의 상자를 나눠 보이고 뺀 때·곳·이유와 다음 할 일을 붙인다', () => {
  const returned = (
    shipmentId: string,
    batchReturn: NonNullable<
      PreparationBucketDto['shipments'][number]['batchReturn']
    >,
    reason: string | null = null
  ) => ({ ...shipment(shipmentId, reason), batchReturn });

  render(
    list({
      bucket: 'resume',
      count: 4,
      singleCount: 4,
      multiCount: 0,
      shortPickCount: 1,
      batchReturnCount: 2,
      shipments: [
        {
          ...shipment('short', null),
          shortPick: [{ name: '상품', locationCode: 'A-01-01', shortQty: 1 }],
          batchReturn: {
            batchNumber: 'OB-1',
            exitedAt: '2026-01-02T01:05:00Z',
            place: '물류앱 피킹',
            reason: '결품 — 재고 부족',
            needsNewWaybill: false,
          },
        },
        returned('voided', {
          batchNumber: 'OB-2',
          exitedAt: '2026-01-02T05:49:00Z',
          place: '물류앱 작업 시작',
          reason: '송장 미발급·재발급 필요',
          needsNewWaybill: true,
        }),
        returned(
          'failed',
          {
            batchNumber: 'OB-3',
            exitedAt: '2026-01-02T06:00:00Z',
            place: null,
            reason: '출고 대상 변경',
            needsNewWaybill: false,
          },
          '운송사가 송장 접수를 거절했어요 — 상자 화면에서 확인해요'
        ),
        shipment('plain', null),
      ],
    })
  );

  const rows = Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.textContent
  );

  expect(rows[0]).toBe(
    '결품으로 돌아온 상자 1건 — 자리 수량을 확인한 뒤 하나씩 골라 주세요'
  );
  expect(rows[1]).toContain('결품 — 상품 1개 모자람 (A-01-01)');
  expect(rows[1]).toContain('1월 2일 10:05 · OB-1에서 뺌 · 물류앱 피킹');
  expect(rows[2]).toBe(
    '배치에서 빠져 돌아온 상자 2건 — 뺀 이유를 보고 다시 준비해 주세요'
  );
  expect(rows[3]).toContain('송장 미발급·재발급 필요');
  expect(rows[3]).toContain('1월 2일 14:49 · OB-2에서 뺌 · 물류앱 작업 시작');
  expect(rows[3]).toContain(
    '«이어서 출고 준비»를 누르면 새 송장을 받아 다시 배치에 담아요'
  );
  expect(rows[4]).toContain('1월 2일 15:00 · OB-3에서 뺌');
  expect(rows[4]).toContain('운송사가 송장 접수를 거절했어요');
  expect(rows[4]).not.toContain('«이어서 출고 준비»');
  expect(rows[5]).toBe('그 밖의 상자');
  expect(rows[6]).toContain('-');
});

it('돌아온 상자가 앞 쪽에서 끝난 쪽은 첫 줄에 «그 밖의 상자»를 단다', () => {
  render(
    list({
      bucket: 'ready',
      count: 3,
      singleCount: 3,
      multiCount: 0,
      shortPickCount: 1,
      batchReturnCount: 1,
      shipments: [shipment('plain', null)],
    })
  );

  const rows = Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.textContent
  );

  expect(rows[0]).toBe('그 밖의 상자');
});
