import { expect, it } from 'vitest';
import {
  operationDiagnostic,
  readDiagnostics,
  recordDiagnostic,
} from './operationDiagnostics';
it('keeps only bounded redacted metadata, never bodies or identity', () => {
  localStorage.clear();
  const op = {
    id: 'op',
    scope: 'secret actor',
    resource: 'secret sku',
    path: '/inbound/simple',
    method: 'POST',
    bodyJson: 'secret barcode token',
    createdAt: Date.now(),
    status: 'confirmed' as const,
    attempts: 2,
  };
  expect(JSON.stringify(operationDiagnostic(op))).not.toContain('secret');
  for (let n = 0; n < 1002; n++) recordDiagnostic(op);
  expect(readDiagnostics()).toHaveLength(1000);
  expect(readDiagnostics(Date.now() + 86401000)).toEqual([]);
});
