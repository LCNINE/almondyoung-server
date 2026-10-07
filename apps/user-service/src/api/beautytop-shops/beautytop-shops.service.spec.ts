import { ConflictError } from '@app/shared';
import { BeautytopShopsService, MAX_WATCHED_SHOPS } from './beautytop-shops.service';

const shop = (shopId: number) => ({ shopKind: 'SHOP' as const, shopId, name: `Shop ${shopId}` });

function make(watchCount: number) {
  const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn(() => ({ onConflictDoNothing }));
  const insert = jest.fn(() => ({ values }));
  const txDeleteWhere = jest.fn().mockResolvedValue(undefined);
  const txInsertValues = jest.fn().mockResolvedValue(undefined);
  const tx = { delete: jest.fn(() => ({ where: txDeleteWhere })), insert: jest.fn(() => ({ values: txInsertValues })) };
  const db = { insert, transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)) };
  const service = new BeautytopShopsService({ db } as never);
  const watch = Array.from({ length: watchCount }, (_, i) => ({ ...shop(i + 1), sido: null, gugun: null, category: null }));
  jest.spyOn(service, 'list').mockResolvedValue({ myShop: null, watch });
  return { service, insert, values, tx, txInsertValues };
}

describe('BeautytopShopsService', () => {
  it(`관심 샵은 ${MAX_WATCHED_SHOPS}곳까지 — 넘치면 저장하지 않는다`, async () => {
    const { service, insert } = make(MAX_WATCHED_SHOPS);
    await expect(service.addWatch('u1', shop(99))).rejects.toBeInstanceOf(ConflictError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('이미 있는 샵을 다시 담으면 가득 찼어도 오류 없이 그대로 둔다', async () => {
    const { service, insert } = make(MAX_WATCHED_SHOPS);
    await expect(service.addWatch('u1', shop(3))).resolves.toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('새 관심 샵은 본인 행으로 저장한다', async () => {
    const { service, values } = make(2);
    await service.addWatch('u1', { ...shop(42), sido: '서울' });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', role: 'WATCH', shopKind: 'SHOP', shopId: 42, sido: '서울', gugun: null }),
    );
  });

  it('내 샵은 지우고 다시 넣는다 — null 이면 지우기만', async () => {
    const set = make(0);
    await set.service.setMyShop('u1', shop(7));
    expect(set.tx.delete).toHaveBeenCalledTimes(1);
    expect(set.txInsertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', role: 'MY_SHOP', shopId: 7 }));

    const clear = make(0);
    await clear.service.setMyShop('u1', null);
    expect(clear.tx.delete).toHaveBeenCalledTimes(1);
    expect(clear.tx.insert).not.toHaveBeenCalled();
  });
});
