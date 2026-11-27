import { listLiveAddOns, withheldForParent } from '../live-add-ons';
import { waivedShippingAmount } from '../waived-shipping';

jest.mock('../waived-shipping');
const waivedMock = jest.mocked(waivedShippingAmount);

describe('live add-ons', () => {
  it('부모마다 취소되지 않은 자식을 묶는다', async () => {
    const knex = {
      raw: jest.fn(async (_sql: string, _bindings: unknown[]) => ({
        rows: [
          { id: 'c1', parent_id: 'p1' },
          { id: 'c2', parent_id: 'p1' },
        ],
      })),
    };

    const map = await listLiveAddOns(knex, 'cus_1', ['p1', 'p2']);

    expect(map.get('p1')).toEqual(['c1', 'c2']);
    expect(map.get('p2')).toBeUndefined();
    expect(knex.raw.mock.calls[0][0]).toContain("status <> 'canceled'");
    expect(knex.raw.mock.calls[0][0]).toContain('customer_id = ?');
    expect(knex.raw.mock.calls[0][1]).toEqual(['p1', 'p2', 'cus_1']);
  });

  it('빈 입력은 조회하지 않는다', async () => {
    const knex = { raw: jest.fn() };

    await expect(listLiveAddOns(knex, 'cus_1', [])).resolves.toEqual(new Map());
    expect(knex.raw).not.toHaveBeenCalled();
  });

  it('살아 있는 자식들의 면제 배송비를 더한다', async () => {
    waivedMock.mockResolvedValueOnce(3000).mockResolvedValueOnce(6000);
    const knex = {
      raw: jest.fn(async (_sql: string, _b: unknown[]) => ({
        rows: [
          { id: 'c1', parent_id: 'p1' },
          { id: 'c2', parent_id: 'p1' },
        ],
      })),
    };

    const query = { graph: jest.fn(async () => ({ data: [{ id: 'p1', customer_id: 'cus_1' }] })) };

    await expect(withheldForParent(knex, query, 'p1')).resolves.toBe(9000);
    expect(knex.raw.mock.calls[0][1]).toEqual(['p1', 'cus_1']);
  });
});
