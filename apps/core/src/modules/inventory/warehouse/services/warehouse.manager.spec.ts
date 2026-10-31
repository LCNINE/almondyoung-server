import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema } from '../../schema/inventory.schema';
import { WarehouseManager } from './warehouse.manager';
import { WarehouseService } from './warehouse.service';

describe('WarehouseService 부팅', () => {
  // 부팅 훅은 요청 밖이라 테넌트 맥락이 없다. 여기서 창고를 만들면 새 테넌트 DB 에도 아몬드영
  // 창고가 생긴다 — 기본 창고는 테넌트 1 전용 시드(`baseline-tenant-1`)가 넣는다.
  it('창고를 만들지 않고, 이미 있는 모든 창고의 시스템 로케이션만 수렴시킨다', async () => {
    const reader = {
      findAll: jest.fn().mockResolvedValue([{ id: 'bucheon' }, { id: 'custom-warehouse' }]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const dbService = { run: jest.fn() };
    const manager = new WarehouseManager(
      dbService as unknown as DbService<typeof wmsSchema>,
      reader as never,
      locationService as never,
    );

    await new WarehouseService(reader as never, manager).onModuleInit();

    expect(dbService.run).not.toHaveBeenCalled();
    expect(locationService.ensureSystemLocations.mock.calls).toEqual([
      ['bucheon', undefined],
      ['custom-warehouse', undefined],
    ]);
  });

  it('빈 DB 에서는 아무것도 쓰지 않는다', async () => {
    const reader = { findAll: jest.fn().mockResolvedValue([]) };
    const locationService = { ensureSystemLocations: jest.fn() };
    const dbService = { run: jest.fn() };
    const manager = new WarehouseManager(dbService as never, reader as never, locationService as never);

    await new WarehouseService(reader as never, manager).onModuleInit();

    expect(dbService.run).not.toHaveBeenCalled();
    expect(locationService.ensureSystemLocations).not.toHaveBeenCalled();
  });
});

describe('WarehouseManager.convergeSystemLocations', () => {
  // 한 테넌트 DB 안의 작업이라 받은 트랜잭션 밖으로 나가면 안 된다 — 테넌트마다 부를 때 다른 DB 에 쓴다.
  it('받은 트랜잭션으로 창고를 읽고 같은 트랜잭션으로 로케이션을 수렴시킨다', async () => {
    const tx = {} as never;
    const reader = { findAll: jest.fn().mockResolvedValue([{ id: 'w1' }]) };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager({ run: jest.fn() } as never, reader as never, locationService as never);

    await manager.convergeSystemLocations(tx);

    expect(reader.findAll).toHaveBeenCalledWith(tx);
    expect(locationService.ensureSystemLocations).toHaveBeenCalledWith('w1', tx);
  });
});

describe('WarehouseManager.update 판매 창고 보존 가드', () => {
  const TARGET = 'bucheon-warehouse';

  /** update 한 번을 돌리고, 실제로 UPDATE 가 나갔는지와 set 페이로드를 함께 돌려준다. */
  function makeManager(otherSellableCount: number) {
    const setPayloads: Array<Record<string, unknown>> = [];
    const returning = jest.fn().mockResolvedValue([{ id: TARGET, name: '부천 물류창고' }]);
    const trx = {
      update: jest.fn(() => ({
        set: jest.fn((payload: Record<string, unknown>) => {
          setPayloads.push(payload);
          return { where: jest.fn(() => ({ returning })) };
        }),
      })),
    };
    const dbService = { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) };
    const countSellableExcluding = jest.fn().mockResolvedValue(otherSellableCount);
    const reader = { countSellableExcluding };
    const locationService = { ensureSystemLocations: jest.fn() };
    const manager = new WarehouseManager(dbService as never, reader as never, locationService as never);

    return { manager, trx, setPayloads, countSellableExcluding };
  }

  // 판매 창고가 부천 하나뿐이라, 이걸 끄면 inSellableWarehouse() 가 공집합을 매칭해
  // 모든 SKU 의 판매가능수량이 0 이 되고 그 상태가 Medusa 로 발행된다. 되돌리기는
  // 쉬워도 그사이 전 상품이 품절로 보인다.
  it('마지막 판매 창고를 끄려 하면 거부한다', async () => {
    const { manager, trx } = makeManager(0);

    await expect(manager.update(TARGET, { isSellable: false })).rejects.toThrow(ConflictError);
    expect(trx.update).not.toHaveBeenCalled();
  });

  it('다른 판매 창고가 남아 있으면 끌 수 있다', async () => {
    const { manager, setPayloads } = makeManager(1);

    await manager.update(TARGET, { isSellable: false });

    expect(setPayloads[0]).toMatchObject({ isSellable: false });
  });

  // 켜는 방향도 같은 카운트를 보지만 판정이 반대다 — 여기서는 "다른 판매 창고가
  // 있으면 거부"(유일성). 마지막-창고 판정에는 걸리지 않는다.
  it('다른 판매 창고가 없으면 켜는 요청이 통과한다', async () => {
    const { manager, setPayloads } = makeManager(0);

    await manager.update(TARGET, { isSellable: true });

    expect(setPayloads[0]).toMatchObject({ isSellable: true });
  });

  // isSellable 을 건드리지 않는 수정(이름·피킹 전략 등)까지 가드에 걸리면,
  // 판매 창고가 하나인 정상 상태에서 창고 설정을 아예 못 바꾸게 된다.
  it('isSellable 이 없는 수정은 가드를 타지 않는다', async () => {
    const { manager, countSellableExcluding, setPayloads } = makeManager(0);

    await manager.update(TARGET, { supportedPickingStrategies: ['discrete'] });

    expect(countSellableExcluding).not.toHaveBeenCalled();
    expect(setPayloads[0]).toMatchObject({ supportedPickingStrategies: ['discrete'] });
  });
});

describe('WarehouseManager.create', () => {
  // fail-closed 의 방어선. create 는 is_sellable 을 일부러 안 싣고 컬럼 DEFAULT(false)에
  // 맡긴다. 누가 여기에 `isSellable: true` 를 넣으면 새로 만든 중국 창고가 판매 창고로
  // 태어나 배 위의 재고가 팔린다 — 이번 변경의 목적 자체가 무력화된다.
  it('is_sellable 을 싣지 않아 컬럼 DEFAULT(false) 가 적용되게 둔다', async () => {
    const values = jest.fn<Promise<Array<Record<string, unknown>>>, [Record<string, unknown>]>();
    const returning = jest.fn().mockResolvedValue([{ id: 'new-warehouse', name: '중국 창고' }]);
    values.mockReturnValue({ returning } as never);
    const trx = { insert: jest.fn().mockReturnValue({ values }) };
    const dbService = { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager(dbService as never, {} as never, locationService as never);

    await manager.create({ name: '중국 창고', type: 'overseas', location: '중국' });

    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).not.toHaveProperty('isSellable');
  });
});

describe('WarehouseManager.update 판매 창고 유일성 가드', () => {
  const TARGET = 'new-warehouse';

  function makeManager(otherSellableCount: number) {
    const setPayloads: Array<Record<string, unknown>> = [];
    const returning = jest.fn().mockResolvedValue([{ id: TARGET, name: '새 창고' }]);
    const trx = {
      update: jest.fn(() => ({
        set: jest.fn((payload: Record<string, unknown>) => {
          setPayloads.push(payload);
          return { where: jest.fn(() => ({ returning })) };
        }),
      })),
    };
    const dbService = { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) };
    const countSellableExcluding = jest.fn().mockResolvedValue(otherSellableCount);
    const manager = new WarehouseManager(
      dbService as never,
      { countSellableExcluding } as never,
      { ensureSystemLocations: jest.fn() } as never,
    );
    return { manager, trx, setPayloads, countSellableExcluding };
  }

  // getDefaultId() 가 "판매 창고" 로 이행 오더의 목적지를 정하므로, 판매 창고가 둘이면
  // 어느 쪽인지 정할 근거가 사라진다. 그 모호함을 주문 처리 시점이 아니라 설정 시점에
  // 터뜨린다 — 늦게 터지면 이미 오더가 엉뚱한 창고로 쌓인 뒤다.
  it('이미 판매 창고가 있으면 두 번째를 켜지 못한다', async () => {
    const { manager, trx } = makeManager(1);

    await expect(manager.update(TARGET, { isSellable: true })).rejects.toThrow(ConflictError);
    expect(trx.update).not.toHaveBeenCalled();
  });

  it('판매 창고가 없으면 켤 수 있다', async () => {
    const { manager, setPayloads } = makeManager(0);

    await manager.update(TARGET, { isSellable: true });

    expect(setPayloads[0]).toMatchObject({ isSellable: true });
  });

  it('isSellable 이 없는 수정은 유일성 가드를 타지 않는다', async () => {
    const { manager, countSellableExcluding, setPayloads } = makeManager(1);

    await manager.update(TARGET, { name: '이름만 변경' });

    expect(countSellableExcluding).not.toHaveBeenCalled();
    expect(setPayloads[0]).toMatchObject({ name: '이름만 변경' });
  });
});
