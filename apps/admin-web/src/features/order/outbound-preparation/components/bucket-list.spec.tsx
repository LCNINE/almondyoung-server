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
