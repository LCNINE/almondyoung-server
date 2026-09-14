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
