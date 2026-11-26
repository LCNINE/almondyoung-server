import { expect, it } from 'vitest';
import { workStatus } from './workStatus';
import type { StoredOperation } from './operationStore';
const op: StoredOperation = {
  id: 'secret-key',
  scope: 'user',
  resource: 'stock',
  method: 'POST',
  path: '/inventory/stocks/adjust',
  bodyJson: '{"barcode":"secret"}',
  createdAt: 100,
  status: 'sending',
  attempts: 1,
};
it('keeps short waits quiet and explains uncertainty without technical detail', () => {
  expect(workStatus([op], 1000).message).toBeNull();
  expect(workStatus([op], 1700).message).toBe('확인하고 있어요.');
  const status = workStatus([{ ...op, status: 'uncertain' }], 101);
  expect(status.blocksWork).toBe(true);
  expect(status.message).toBe(
    '재고 조정 1건의 처리 여부를 확인하고 있어요. 같은 조정을 다시 하지 마세요.'
  );
  expect(status.message).not.toMatch(/secret|POST|adjust|retry|HTTP/);
  expect(status.screen).toBe('/inventory');
});
it('권한 부족으로 막힌 작업은 처리 여부 대신 필요한 권한과 다음 행동을 안내한다', () => {
  const denied: StoredOperation = {
    ...op,
    status: 'uncertain',
    errorCode: 'FORBIDDEN',
    requiredPermissions: ['inventory.stock.adjust'],
  };
  const status = workStatus([denied], 101);
  expect(status.blocksWork).toBe(true);
  expect(status.message).toBe(
    '‘재고 조정’ 권한이 없어 재고 조정 1건의 처리 결과를 확인하지 못했어요. 관리자에게 권한을 받은 뒤 「처리 내역 확인」을 누르고, 그래도 같으면 다시 로그인해 주세요.'
  );
  const mixed = workStatus(
    [denied, { ...op, id: 'other', status: 'uncertain' }],
    101
  );
  expect(mixed.message).toBe(
    '재고 조정 2건의 처리 여부를 확인하고 있어요. 같은 조정을 다시 하지 마세요.'
  );
});
it('작업마다 다른 권한이 필요하면 모두 받아야 하는 것으로 나열한다', () => {
  const denied = (id: string, keys: string[]): StoredOperation => ({
    ...op,
    id,
    status: 'uncertain',
    errorCode: 'FORBIDDEN',
    requiredPermissions: keys,
  });
  expect(
    workStatus(
      [
        denied('a', ['inventory.stock.adjust']),
        denied('b', ['inventory.stock.operate']),
        denied('c', ['inventory.stock.adjust']),
      ],
      101
    ).message
  ).toMatch(/^‘재고 조정’, ‘재고 현장 작업’ 권한이 없어/);
});
it('요구 권한 없이 저장된 권한 거부 기록도 권한 안내를 준다', () => {
  for (const errorCode of ['FORBIDDEN', 'Forbidden'])
    expect(
      workStatus([{ ...op, status: 'uncertain', errorCode }], 101).message
    ).toBe(
      '권한이 없어 재고 조정 1건의 처리 결과를 확인하지 못했어요. 관리자에게 권한을 받은 뒤 「처리 내역 확인」을 누르고, 그래도 같으면 다시 로그인해 주세요.'
    );
});

it('남은 작업의 종류·이름을 말하고, 화면마다 뜻이 바뀌는 «이 상품» 이라고 하지 않는다', () => {
  const inbound: StoredOperation = {
    ...op,
    path: '/inbound/simple',
    bodyJson: JSON.stringify({ items: [{ skuId: 'sku-1', quantity: 1 }] }),
    summary: '데모 상품 11 ×1',
    status: 'uncertain',
  };
  const status = workStatus([inbound], 101);
  expect(status).toEqual({
    message:
      '입고 1건(데모 상품 11 ×1)의 처리 여부를 확인하고 있어요. 이 입고를 다시 등록하지 마세요.',
    blocksWork: true,
    screen: '/inbound/quick',
  });
  expect(status.message).not.toContain('이 상품');
  const denied = workStatus(
    [
      {
        ...inbound,
        errorCode: 'FORBIDDEN',
        requiredPermissions: ['inventory.stock.adjust'],
      },
    ],
    101
  );
  expect(denied.message).toMatch(
    /^‘재고 조정’ 권한이 없어 입고 1건\(데모 상품 11 ×1\)의 처리 결과를/
  );
  expect(denied.screen).toBe('/inbound/quick');
  expect(workStatus([{ ...inbound, createdAt: 0 }], 29 * 86400000)).toEqual({
    message:
      '오래된 작업이 있어요: 입고 1건(데모 상품 11 ×1). 관리자와 처리 내역을 확인해 주세요.',
    blocksWork: true,
    screen: '/inbound/quick',
  });
});

it('다시 보내는 중에도 결과 모름 안내를 그대로 둔다 — 재시도 사이마다 안내가 바뀌지 않게', () => {
  const resending = workStatus(
    [{ ...op, status: 'sending', attempts: 2 }],
    5000
  );
  expect(resending.message).toBe(
    '재고 조정 1건의 처리 여부를 확인하고 있어요. 같은 조정을 다시 하지 마세요.'
  );
  expect(
    workStatus([{ ...op, status: 'sending', attempts: 1 }], 5000).message
  ).toBe('확인하고 있어요.');
});
