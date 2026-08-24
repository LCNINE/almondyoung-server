import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema } from '../../schema/inventory.schema';
import { WarehouseManager } from './warehouse.manager';
import { WAREHOUSE_CONSTANTS } from '../../core/constants/warehouse.constants';

const DOMESTIC = WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE;
const OVERSEAS = WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE;

/** `typeof trx` 로 쓰면 run 콜백 시그니처가 자기 자신을 참조해 TS2502 가 난다. */
type FakeTrx = {
  insert: jest.Mock;
  update?: jest.Mock;
};

describe('WarehouseManager system-location bootstrap', () => {
  it('backfills required system roles for every existing warehouse, including custom warehouses', async () => {
    const reader = {
      // 기본 창고 행이 이미 있으면 ensureDefaultsExist 는 UPDATE 를 내지 않는다.
      findOneOrNull: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(
            id === DOMESTIC.id ? { id, isSellable: DOMESTIC.isSellable } : { id, isSellable: OVERSEAS.isSellable },
          ),
        ),
      findAll: jest.fn().mockResolvedValue([{ id: 'default-domestic' }, { id: 'custom-warehouse' }]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const dbService = { run: jest.fn() };
    const manager = new WarehouseManager(
      dbService as unknown as DbService<typeof wmsSchema>,
      reader as never,
      locationService as never,
    );

    await manager.ensureDefaultsExist();

    expect(dbService.run).not.toHaveBeenCalled();
    expect(locationService.ensureSystemLocations).toHaveBeenCalledTimes(2);
    expect(locationService.ensureSystemLocations).toHaveBeenCalledWith('default-domestic');
    expect(locationService.ensureSystemLocations).toHaveBeenCalledWith('custom-warehouse');
  });
});

describe('WarehouseManager default warehouse seeding', () => {
  // supportedPickingStrategies 가 비면 그 창고는 출고 배치를 만들 수 없다
  // (outbound-batch-orchestrator.service.ts 의 게이트). 국내 창고는 discrete 로
  // 레거시 동등한 안전 기본값을 갖고, 토탈·멀티오더는 창고 설정 화면에서 켠다.
  it('국내 기본 창고는 판매 창고이고 discrete 를 지원 전략으로 갖는다', () => {
    expect(DOMESTIC.supportedPickingStrategies).toEqual(['discrete']);
    expect(DOMESTIC.isSellable).toBe(true);
  });

  // 해외(중국) 창고는 비판매 창고다. 그래서 출고 배치 게이트가 막아야 하고,
  // 지원 전략은 의도적으로 비어 있다 — discrete 를 켜두면 이 창고로 피킹 배치가
  // 만들어져 판매 게이트를 우회한다.
  it('해외 기본 창고는 비판매 창고이고 지원 전략이 비어 출고 배치 게이트에 막힌다', () => {
    expect(OVERSEAS.supportedPickingStrategies).toEqual([]);
    expect(OVERSEAS.isSellable).toBe(false);
  });

  it('기본 창고가 없으면 지원 전략과 판매 여부까지 함께 insert 한다', async () => {
    const values = jest.fn<Promise<void>, [Record<string, unknown>]>().mockResolvedValue(undefined);
    const trx: FakeTrx = { insert: jest.fn().mockReturnValue({ values }) };
    const dbService = { run: jest.fn((fn: (executor: FakeTrx) => unknown) => fn(trx)) };
    const reader = {
      findOneOrNull: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager(dbService as never, reader as never, locationService as never);

    await manager.ensureDefaultsExist();

    expect(values).toHaveBeenCalledTimes(2);
    expect(values.mock.calls[0][0]).toMatchObject({
      id: DOMESTIC.id,
      supportedPickingStrategies: ['discrete'],
      isSellable: true,
    });
    expect(values.mock.calls[1][0]).toMatchObject({
      id: OVERSEAS.id,
      supportedPickingStrategies: [],
      isSellable: false,
    });
  });
});

describe('WarehouseManager 이미 존재하는 기본 창고 처리', () => {
  /** 이미 존재하는 기본 창고 행이 있을 때의 ensureDefaultsExist 를 돌리고, UPDATE 로 나간 set 페이로드를 모은다. */
  async function runConvergence(existingOverseas: Record<string, unknown>) {
    const setPayloads: Array<Record<string, unknown>> = [];
    const trx: Required<FakeTrx> = {
      update: jest.fn(() => ({
        set: jest.fn((payload: Record<string, unknown>) => {
          setPayloads.push(payload);
          return { where: jest.fn().mockResolvedValue(undefined) };
        }),
      })),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    };
    const dbService = { run: jest.fn((fn: (executor: FakeTrx) => unknown) => fn(trx)) };
    const reader = {
      findOneOrNull: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === DOMESTIC.id ? { id, isSellable: DOMESTIC.isSellable } : existingOverseas),
        ),
      findAll: jest.fn().mockResolvedValue([]),
    };
    const locationService = { ensureSystemLocations: jest.fn().mockResolvedValue(undefined) };
    const manager = new WarehouseManager(dbService as never, reader as never, locationService as never);

    await manager.ensureDefaultsExist();

    return { setPayloads, trx };
  }

  // is_sellable 은 이제 운영자가 창고 설정 화면에서 바꾸는 값이다. 부팅 수렴이 남아
  // 있으면 운영자가 끈 판매 창고가 다음 재시작에 조용히 되살아난다 — 컬럼에 주인이
  // 둘이 되는 상태다. 원래 수렴은 "컬럼이 DEFAULT true 로 깔려 기존 해외 창고 행이
  // 판매 창고로 남는다"는 일회성 백필이었고, 그 임무는 이미 끝났다.
  it('운영자가 바꾼 is_sellable 을 부팅이 되돌리지 않는다', async () => {
    const { setPayloads, trx } = await runConvergence({
      id: OVERSEAS.id,
      isSellable: true,
      supportedPickingStrategies: ['discrete', 'total'],
    });

    expect(setPayloads).toHaveLength(0);
    expect(trx.update).not.toHaveBeenCalled();
  });

  // 회귀 방어선: 누군가 "기본 창고 상수를 전부 수렴시키자" 며 이 경로를 넓히면
  // 운영자가 창고 설정 화면(UpdateWarehouseDto.supportedPickingStrategies)에서 켠
  // 토탈·멀티오더 전략이 core 재시작 때마다 상수 값으로 되돌아간다.
  it('supported_picking_strategies 는 수렴 대상이 아니다 — 운영자 설정을 덮어쓰지 않는다', async () => {
    const { setPayloads } = await runConvergence({
      id: OVERSEAS.id,
      isSellable: true,
      supportedPickingStrategies: ['discrete', 'total'],
    });

    for (const payload of setPayloads) {
      expect(payload).not.toHaveProperty('supportedPickingStrategies');
    }
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

  it('판매 창고로 켜는 요청은 카운트를 보지 않는다', async () => {
    const { manager, countSellableExcluding, setPayloads } = makeManager(0);

    await manager.update(TARGET, { isSellable: true });

    expect(countSellableExcluding).not.toHaveBeenCalled();
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
