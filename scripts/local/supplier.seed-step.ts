/**
 * 로컬 core DB 에 「개발용 공급처」 1행을 넣는다 — 파괴적이지 않고 멱등.
 *
 * 🔴 이게 없으면 어드민 매칭 화면의 「SKU 구성 매칭」 다이얼로그에서 **공급처(발주처) 드롭다운이
 * 비어 있다.** 세 필수 필드(공급처·물류처·재고소유) 중 이것만 채울 수 없어 저장 버튼이 영영 열리지
 * 않고, 매칭을 시작조차 못 한다 (#795). 물류처·재고소유는 core 부팅이 수렴시키는데 공급처만
 * 그 경로가 없어서, `dev_core` 를 새로 만들면 여기서 막힌다.
 *
 * 다이얼로그 안의 「신규 등록」(`SearchDialog` → `POST /suppliers`) 으로 손수 만들 수는 있다.
 * 하지만 그건 `inventory.manage` 스코프를 요구하고, 무엇보다 **새 DB 를 만들 때마다 사람이
 * 클릭으로 때워야 한다** — 시드가 할 일이다.
 * (#795 본문의 「구현이 `window.prompt()` 라 자동화가 못 지난다」는 옛 코드 기준이다. 그 경로는
 *  2026-09-06 #791 에서 toast/`SearchDialog` 로 바뀌었고, 지금 이 다이얼로그엔 브라우저 모달이 없다.)
 *
 * 발주도 같이 막힌다: `CreatePurchaseOrderDto.supplierId` 가 `@IsUUID()` 필수다.
 *
 * ## 왜 `scripts/seeding/steps/` 가 아니라 여기인가
 *
 * 공급처는 **로컬 픽스처**이지 reference 데이터가 아니다. 라이브·dev 배포에는 실제 공급처 행이
 * 이미 있고, 거기에 「개발용 공급처」가 끼면 발주처 드롭다운이 오염된다 — `purchase_orders` 의 FK 가
 * `ON DELETE restrict` 라 한 번 발주에 쓰이면 지우지도 못한다. 그래서 이 스텝은
 * `scripts/seeding/phases/03-seed-orchestrator.ts` 에 **등록하지 않는다**. `db:seed:ref` 는 이걸
 * 안 돈다.
 *
 * ## id 를 `seed-dev-core` 와 공유한다
 *
 * `SEED_IDS.supplier` 를 그대로 쓴다. 두 로컬 시드(`seed-dev-core` 와 이 스텝)를 다 돌려도
 * 공급처가 두 벌이 되지 않는다 — 같은 행이다. 상수를 복제하지 않으므로 어긋날 여지도 없다.
 *
 * ## conflict 대상이 `id` 인 근거
 *
 * `suppliers` 의 UNIQUE 는 PK(`id`) 하나뿐이다. `name`·`code` 에는 UNIQUE 가 없다
 * (baseline 마이그레이션 + 2026-09-06 `\d suppliers` 실측). `sales_channels` 처럼 다른 컬럼에
 * UNIQUE 가 걸려 있었다면 `ON CONFLICT (id)` 가 그 위반을 못 받아내고 apply 가 `success:false` 로
 * 끝났을 텐데, 그 함정은 이 테이블엔 없다.
 */
import { SeedStep } from '../seeding/steps/base-seed-step';
import { SeedApplyResult, SeedCheckResult } from '../seeding/lib/types';
import { SEED_IDS } from './seed-dev-core/constants';

interface IdRow {
  id: string;
}

interface CountRow {
  count: number;
}

/**
 * `default_warehouse_id` 는 여기서 고정하지 않고 apply 시점에 DB 에서 고른다.
 * 창고 id 가 환경마다 다르기 때문이다 — `seed-dev-core` 를 돌린 DB 는 `FIXED_UUIDS` 의 창고
 * 2개(`019d0001-…`)를 갖고, 그냥 core 를 띄우기만 한 DB 는 부팅 수렴이 만든
 * `WAREHOUSE_CONSTANTS` 의 창고 2개(`00000000-…`)를 갖는다. 상수를 박으면 없는 창고를 가리켜
 * FK 위반으로 apply 가 통째로 실패한다.
 */
export const SUPPLIER_SEEDS = [
  {
    id: SEED_IDS.supplier,
    name: '개발용 공급처',
    code: 'DEV-SUP',
    email: 'supplier@example.com',
    phone: '02-0000-0000',
    isDirectDelivery: false,
    paymentMethod: 'postpaid',
  },
];

export class SupplierLocalSeedStep extends SeedStep {
  /**
   * orchestrator 에 등록하지 않으므로 이 값은 실제로 필터링에 쓰이지 않는다.
   * 라이브·dev 시드 그룹('baseline'/'backfill')과 섞이지 않는다는 표시로 둔다.
   */
  readonly groups = ['local'] as const;

  constructor(databaseUrl: string) {
    super('SupplierLocal', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const ids = SUPPLIER_SEEDS.map((s) => s.id);
    const existing = await this.findExistingIds('suppliers', ids);
    const missing = ids.filter((id) => !existing.has(id));

    // 행만 있고 입고 창고가 비면 발주가 400 으로 막힌다(`getSupplierDefaultWarehouseId`).
    // 매칭 다이얼로그만 보면 다 채운 것처럼 보이므로 별도 항목으로 센다.
    const withoutWarehouse = await this.countSeededWithoutWarehouse(ids);
    const warehouseCount = await this.countRows('warehouses');

    const items = [
      {
        entity: 'suppliers',
        expected: SUPPLIER_SEEDS.length,
        existing: existing.size,
        missing: missing.length,
        missingDetails: missing.map((id) => SUPPLIER_SEEDS.find((s) => s.id === id)!.name),
      },
      {
        entity: 'suppliers.default_warehouse_id',
        expected: existing.size,
        existing: existing.size - withoutWarehouse,
        missing: withoutWarehouse,
      },
    ];

    const isFullySeeded = missing.length === 0 && withoutWarehouse === 0;

    return {
      service: this.serviceName,
      items,
      isFullySeeded,
      summary: isFullySeeded
        ? 'All local supplier seed data present'
        : warehouseCount === 0
          ? '창고가 0행이다 — core 를 한 번 띄워 기본 창고를 만든 뒤 다시 돌릴 것'
          : `${missing.length} missing supplier(s), ${withoutWarehouse} without default warehouse`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      this.logger.step(1, 3, 'Resolving default warehouse');
      const defaultWarehouseId = await this.resolveDefaultWarehouseId();
      if (defaultWarehouseId === null) {
        this.logger.warn(
          '창고가 0행이라 입고 창고 없이 공급처를 넣는다 — 매칭은 열리지만 발주는 400 으로 막힌다. ' +
            'core 를 한 번 띄운 뒤 이 시드를 다시 돌리면 채워진다.',
        );
      }

      this.logger.step(2, 3, 'Inserting suppliers');
      for (const s of SUPPLIER_SEEDS) {
        const inserted = await this.client<IdRow[]>`
          INSERT INTO suppliers (
            id, name, code, email, phone, payment_method, is_direct_delivery, default_warehouse_id
          )
          VALUES (
            ${s.id}, ${s.name}, ${s.code}, ${s.email}, ${s.phone},
            ${s.paymentMethod}, ${s.isDirectDelivery}, ${defaultWarehouseId}
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        itemsApplied += inserted.length;
      }

      // 창고보다 공급처가 먼저 들어간 DB 를 나중 실행이 수렴시킨다.
      // 사람이 골라둔 값은 건드리지 않는다 — NULL 인 행만 채운다.
      this.logger.step(3, 3, 'Backfilling default warehouse');
      if (defaultWarehouseId !== null) {
        const updated = await this.client<IdRow[]>`
          UPDATE suppliers
             SET default_warehouse_id = ${defaultWarehouseId},
                 updated_at = now()
           WHERE id = ANY(${SUPPLIER_SEEDS.map((s) => s.id)})
             AND default_warehouse_id IS NULL
          RETURNING id
        `;
        itemsApplied += updated.length;
      }

      this.logger.success(`Local supplier seeding completed (${itemsApplied} row(s) written)`);
      return {
        service: this.serviceName,
        success: true,
        itemsApplied,
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      this.logger.error('Local supplier seeding failed', error);
      return {
        service: this.serviceName,
        success: false,
        itemsApplied,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 해외 창고를 우선한다 — `seed-dev-core` 가 같은 공급처에 중국 창고를 물려 두었기 때문이다.
   * 출발(공급처 기본창고)이 목적지와 달라야 `requiresTransfer=true` 인 해외 발주 경로가 열리고,
   * 그게 라이브의 실제 모양이다. 해외 창고가 없으면 아무 창고나(id 순) 잡는다.
   */
  private async resolveDefaultWarehouseId(): Promise<string | null> {
    const rows = await this.client<IdRow[]>`
      SELECT id::text AS id
      FROM warehouses
      ORDER BY (type = 'overseas') DESC, id
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private async countSeededWithoutWarehouse(ids: string[]): Promise<number> {
    const rows = await this.client<CountRow[]>`
      SELECT count(*)::int AS count
      FROM suppliers
      WHERE id = ANY(${ids})
        AND default_warehouse_id IS NULL
    `;
    return rows[0]?.count ?? 0;
  }
}
