import { describe, expect, it } from 'vitest';
import { describePendingWork, workSummary } from './pendingWork';
import type { StoredOperation } from './operationStore';

const op = (
  path: string,
  body: Record<string, unknown>,
  extra: Partial<StoredOperation> = {}
): StoredOperation => ({
  id: `${path}-${extra.createdAt ?? 1}`,
  scope: 'worker',
  resource: path,
  method: 'POST',
  path,
  bodyJson: JSON.stringify(body),
  createdAt: 1,
  status: 'uncertain',
  attempts: 1,
  ...extra,
});

describe('describePendingWork', () => {
  it('화면이 남긴 이름으로 작업과 대상을 말하고 그 작업의 화면을 알려 준다', () => {
    expect(
      describePendingWork([
        op(
          '/inbound/simple',
          { items: [{ skuId: 'sku-1', quantity: 1 }] },
          { summary: '데모 상품 11 ×1' }
        ),
      ])
    ).toEqual({
      what: '입고 1건(데모 상품 11 ×1)',
      dontRepeat: '이 입고를 다시 등록하지 마세요.',
      screen: '/inbound/quick',
    });
  });

  it('이름이 없는 기록은 본문의 종류·수량으로 말하고 id 는 보이지 않는다', () => {
    const described = describePendingWork([
      op('/inbound/simple', {
        items: [
          { skuId: 'sku-secret', quantity: 2 },
          { skuId: 'sku-other', quantity: 3 },
        ],
      }),
    ]);
    expect(described?.what).toBe('입고 1건(상품 2종 5개)');
    expect(described?.what).not.toMatch(/sku/);
  });

  it('실사 스캔은 찍은 바코드로, 실사 화면은 그 실사로 간다', () => {
    expect(
      describePendingWork([
        op('/stocktaking/scan-product', {
          sessionId: 'session-1',
          productBarcode: '880100000011',
          quantity: 2,
        }),
      ])
    ).toEqual({
      what: '실사 1건(상품 바코드 880100000011 ×2)',
      dontRepeat: '같은 상품을 다시 세지 마세요.',
      screen: '/stocktaking/session-1',
    });
    expect(
      describePendingWork([
        op('/stocktaking/sessions/session-2/complete', { previewToken: 't' }),
      ])?.screen
    ).toBe('/stocktaking/session-2');
  });

  it('작업마다 그 작업을 하는 화면으로 간다', () => {
    const screenOf = (path: string, body: Record<string, unknown> = {}) =>
      describePendingWork([op(path, body)])?.screen;
    expect(screenOf('/inbound/putaway', { quantity: 1 })).toBe('/putaway');
    expect(screenOf('/movement/move')).toBe('/movement');
    expect(screenOf('/inbound/cancel')).toBe('/inbound/history');
    expect(
      screenOf('/inventory/inbound-shipments/s-1/boxes/b-1/receive/cancel')
    ).toBe('/inbound/boxes');
    expect(screenOf('/purchase-orders/po-1/receipts')).toBe(
      '/inbound/purchase-orders/po-1'
    );
    expect(screenOf('/purchase-orders/receipt-lines/line-1/cancel')).toBe(
      '/inbound/history'
    );
    expect(screenOf('/inventory/inbound-shipments/s-1/boxes/b-1/receive')).toBe(
      '/inbound/boxes'
    );
    expect(screenOf('/inventory/stocks/adjust', { delta: -2 })).toBe(
      '/inventory'
    );
    expect(screenOf('/shipments/s-1/location-outbound-scans')).toBe(
      '/outbound'
    );
  });

  it('여러 건·여러 종류면 종류별 건수로 말하고, 가장 먼저 남은 작업의 화면으로 간다', () => {
    const described = describePendingWork([
      op(
        '/stocktaking/scan-location',
        { sessionId: 's', locationBarcode: 'A-01' },
        { createdAt: 3 }
      ),
      op(
        '/inbound/simple',
        { items: [{ skuId: 'a', quantity: 1 }] },
        { createdAt: 1, summary: '데모 상품 11 ×1' }
      ),
      op(
        '/inbound/simple',
        { items: [{ skuId: 'b', quantity: 1 }] },
        { createdAt: 2, summary: '데모 상품 12 ×1' }
      ),
    ]);
    expect(described).toEqual({
      what: '입고 2건(데모 상품 11 ×1 외 1건)·실사 1건(위치 A-01)',
      dontRepeat: '같은 작업을 다시 하지 마세요.',
      screen: '/inbound/quick',
    });
  });

  it('입고 취소는 등록이 아니라 취소를 다시 하지 말라고 한다', () => {
    for (const path of [
      '/inbound/cancel',
      '/purchase-orders/receipt-lines/line-1/cancel',
      '/inventory/inbound-shipments/s-1/boxes/b-1/receive/cancel',
    ])
      expect(
        describePendingWork([
          op(path, { quantity: 2 }, { summary: '데모 상품 11 ×2' }),
        ])
      ).toMatchObject({
        what: '입고 취소 1건(데모 상품 11 ×2)',
        dontRepeat: '이 입고를 다시 취소하지 마세요.',
      });
  });

  it('같은 경로를 여러 화면이 쓰면 화면이 남긴 곳으로 간다', () => {
    expect(
      describePendingWork([
        op(
          '/movement/move',
          { lines: [{ quantity: 1 }] },
          { screen: '/putaway' }
        ),
      ])?.screen
    ).toBe('/putaway');
  });

  it('남은 작업이 없으면 null', () => {
    expect(describePendingWork([])).toBeNull();
  });
});

it('workSummary 는 첫 상품과 나머지 종류 수로 줄인다', () => {
  expect(workSummary([])).toBeUndefined();
  expect(workSummary([{ name: '데모 상품 11', quantity: 3 }])).toBe(
    '데모 상품 11 ×3'
  );
  expect(
    workSummary([
      { name: '데모 상품 11', quantity: 3 },
      { name: '데모 상품 12', quantity: 1 },
      { name: '데모 상품 13', quantity: 1 },
    ])
  ).toBe('데모 상품 11 ×3 외 2종');
});
