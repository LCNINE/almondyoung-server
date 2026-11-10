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
  expect(status.message).toContain('다시 찍지 마세요');
  expect(status.message).not.toMatch(/secret|POST|adjust|retry|HTTP/);
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
    '‘재고 조정’ 권한이 없어 처리 결과를 확인하지 못했어요. 관리자에게 권한을 받은 뒤 「처리 내역 확인」을 누르고, 그래도 같으면 다시 로그인해 주세요.'
  );
  const mixed = workStatus(
    [denied, { ...op, id: 'other', status: 'uncertain' }],
    101
  );
  expect(mixed.message).toContain('다시 찍지 마세요');
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
      '권한이 없어 처리 결과를 확인하지 못했어요. 관리자에게 권한을 받은 뒤 「처리 내역 확인」을 누르고, 그래도 같으면 다시 로그인해 주세요.'
    );
});
