import { Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx, SkuDemandProfile } from '../../schema/inventory.schema';
import { LeadTimeObservation } from '../rules/effective-parameters';
import { routeKey } from '../rules/replenishment-rules.reader';

/**
 * A 가 물질화한 프로필 3표 읽기. 제안 조립이 쓴다.
 *
 * 한 제안 런의 읽기가 같은 스냅샷을 보게 하는 건 **호출처가 `trx` 를 명시로 넘겨** 지킨다 —
 * `ReplenishmentRulesReader` 와 같은 형태다(CLAUDE.md: 공개 메서드는 `tx?: DbTx` 를 마지막 인자로).
 */
@Injectable()
export class DemandProfileReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async readProfiles(skuIds: string[], tx?: DbTx): Promise<Map<string, SkuDemandProfile>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(wmsTables.skuDemandProfiles)
        .where(inArray(wmsTables.skuDemandProfiles.skuId, unique));
      return new Map(rows.map((r) => [r.skuId, r]));
    }, tx);
  }

  async readSupplierLeadTimes(tx?: DbTx): Promise<Map<string, LeadTimeObservation>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.supplierLeadTimeProfiles);
      return new Map(
        rows.map((r) => [r.supplierId, { observations: r.observations, meanDays: r.meanDays, stdDays: r.stdDays }]),
      );
    }, tx);
  }

  async readRouteLeadTimes(tx?: DbTx): Promise<Map<string, LeadTimeObservation>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.routeLeadTimeProfiles);
      return new Map(
        rows.map((r) => [
          routeKey(r.fromWarehouseId, r.toWarehouseId),
          { observations: r.observations, meanDays: r.meanDays, stdDays: r.stdDays },
        ]),
      );
    }, tx);
  }
}
