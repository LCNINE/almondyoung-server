import { MedusaError } from '@medusajs/framework/utils';

import { parseInput } from '../parse-input';

describe('return settle parseInput', () => {
  const base = { requestId: 'r1', items: [{ item_id: 'i1', received: 1, dismissed: 0 }] };

  it('item_id/received/dismissed 를 itemId/received/dismissed 로, refundMode 가 없으면 칸이 없다', () => {
    expect(parseInput(base)).toEqual({ requestId: 'r1', items: [{ itemId: 'i1', received: 1, dismissed: 0 }] });
  });
  it.each(['auto', 'manual'])('refundMode %s 는 그대로', (mode) => {
    expect(parseInput({ ...base, refundMode: mode }).refundMode).toBe(mode);
  });
  it.each([
    [{}],
    [{ requestId: ' ', items: base.items }],
    [{ requestId: 'r', items: [] }],
    [{ requestId: 'r', items: [{ item_id: 'i', received: 1 }] }],
    [{ requestId: 'r', items: [{ item_id: 'i', received: -1, dismissed: 1 }] }],
    [{ requestId: 'r', items: [{ item_id: 'i', received: 0.5, dismissed: 0 }] }],
    [{ requestId: 'r', items: [{ item_id: '', received: 1, dismissed: 0 }] }],
    [{ ...base, refundMode: 'MANUAL' }],
  ])('INVALID_DATA: %j', (body) => {
    try {
      parseInput(body);
      throw new Error('던지지 않았다');
    } catch (e) {
      expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
    }
  });
});
