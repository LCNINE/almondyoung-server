import { DbTx } from '../../schema/inventory.schema';
import { findLocationIdsInUse } from './rack-bin-sync';

describe('findLocationIdsInUse', () => {
  it('locations 를 가리키는 외래키를 하나도 못 찾으면 «전부 안 씀»으로 열리지 않고 멈춘다', async () => {
    // 카탈로그 해석이 빗나가면(search_path 등) 외래키 0개 → 후보 칸이 전부 지워지고 SET NULL 이력이 NULL 이 된다.
    const tx = { execute: jest.fn().mockResolvedValue([]) } as unknown as DbTx;

    await expect(findLocationIdsInUse(tx, ['00000000-0000-0000-0000-000000000001'])).rejects.toThrow(/외래키/);
  });
});
