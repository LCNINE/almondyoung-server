import { MedusaError } from '@medusajs/framework/utils';

import { parseInput } from '../parse-input';

describe('partial-cancel parseInput', () => {
  it('item_id/quantity 를 itemId/quantity 로', () => {
    expect(parseInput({ requestId: 'r1', items: [{ item_id: 'i1', quantity: 2 }] })).toEqual({ requestId: 'r1', items: [{ itemId: 'i1', quantity: 2 }] });
  });
  it.each([
    [{}],
    [{ requestId: '', items: [{ item_id: 'i', quantity: 1 }] }],
    [{ requestId: 'r', items: [] }],
    [{ requestId: 'r', items: [{ item_id: 'i', quantity: 1.5 }] }],
    [{ requestId: 'r', items: [{ item_id: 'i', quantity: '1' }] }],
  ])('거절: %j', (body) => {
    expect(() => parseInput(body)).toThrow();
  });

  describe('refundMode (#1016 36번 재설계 §6.1)', () => {
    const base = { requestId: 'r1', items: [{ item_id: 'i1', quantity: 1 }] };

    it('없으면 칸이 없다 — 오케스트레이터가 auto 로 읽는다', () => {
      expect(parseInput(base)).not.toHaveProperty('refundMode');
    });

    it.each(['auto', 'manual'])('%s 는 그대로', (mode) => {
      expect(parseInput({ ...base, refundMode: mode }).refundMode).toBe(mode);
    });

    it('그 밖은 INVALID_DATA', () => {
      try {
        parseInput({ ...base, refundMode: 'MANUAL' });
        throw new Error('던지지 않았다');
      } catch (e) {
        expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
      }
    });
  });

  describe('reasonCode·requestedBy (K8 PR1 — 택배비는 사유가 정한다)', () => {
    const base = { requestId: 'r1', items: [{ item_id: 'i1', quantity: 1 }] };

    it('그대로 나온다', () => {
      const out = parseInput({ ...base, reasonCode: 'OUT_OF_STOCK', requestedBy: 'operator' });
      expect(out.reasonCode).toBe('OUT_OF_STOCK');
      expect(out.requestedBy).toBe('operator');
    });

    it('둘 다 없으면 키가 없다', () => {
      const out = parseInput(base);
      expect(out).not.toHaveProperty('reasonCode');
      expect(out).not.toHaveProperty('requestedBy');
    });

    it.each([
      [{ reasonCode: 1 }],
      [{ requestedBy: {} }],
    ])('문자열이 아니면 INVALID_DATA: %j', (extra) => {
      expect(() => parseInput({ ...base, ...extra })).toThrow(MedusaError);
    });
  });
});
