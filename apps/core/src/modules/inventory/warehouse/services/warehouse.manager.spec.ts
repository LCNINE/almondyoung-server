import { DbService } from '@app/db';
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
      // 이미 상수와 같은 is_sellable 이면 수렴 UPDATE 가 안 나가야 한다.
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

describe('WarehouseManager default warehouse convergence', () => {
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

  // 마이그레이션이 is_sellable 을 DEFAULT true 로 깔았으므로, 이미 존재하는 라이브
  // 중국 창고 행은 이 수렴이 없으면 영원히 판매 창고로 남는다. 그러면
  // inSellableWarehouse() 가 모든 창고를 매칭해 판매 게이트가 no-op 이 되고
  // 공급 파이프라인의 ①②(비판매 창고 술어)는 항상 공집합을 낸다.
  it('이미 존재하는 기본 창고의 is_sellable 을 상수 값으로 수렴시킨다', async () => {
    const { setPayloads } = await runConvergence({
      id: OVERSEAS.id,
      isSellable: true,
      supportedPickingStrategies: ['discrete', 'total'],
    });

    expect(setPayloads).toHaveLength(1);
    expect(setPayloads[0]).toMatchObject({ isSellable: false });
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

  it('is_sellable 이 이미 상수와 같으면 UPDATE 를 내지 않는다', async () => {
    const { setPayloads, trx } = await runConvergence({
      id: OVERSEAS.id,
      isSellable: false,
      supportedPickingStrategies: ['discrete', 'total'],
    });

    expect(setPayloads).toHaveLength(0);
    expect(trx.update).not.toHaveBeenCalled();
  });
});
