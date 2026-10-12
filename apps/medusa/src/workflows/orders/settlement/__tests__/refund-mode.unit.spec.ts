import { MedusaError } from '@medusajs/framework/utils';
import { parseRefundMode } from '../refund-mode';

describe('parseRefundMode (#1016 36번 재설계 §6.1)', () => {
  it.each([[undefined, 'auto'], [null, 'auto'], ['auto', 'auto'], ['manual', 'manual']])('%p → %s', (input, expected) => {
    expect(parseRefundMode(input)).toBe(expected);
  });

  it.each(['MANUAL', 'refund', 1, {}])('그 밖(%p)은 INVALID_DATA', (input) => {
    try {
      parseRefundMode(input);
      throw new Error('던지지 않았다');
    } catch (e) {
      expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
    }
  });
});
