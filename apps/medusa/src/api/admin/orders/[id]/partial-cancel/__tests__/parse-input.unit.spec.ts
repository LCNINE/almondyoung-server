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
});
