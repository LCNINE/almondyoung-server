import { Injectable } from '@nestjs/common';
import { asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import {
  wmsSchema,
  wmsTables,
  DbTx,
  ReplenishmentGradeRule,
  ReplenishmentRouteRule,
  ReplenishmentSkuOverride,
  ReplenishmentSupplierRule,
} from '../../schema/inventory.schema';
import { DemandGrade } from '../demand/demand-profile.calculator';

export function routeKey(fromWarehouseId: string, toWarehouseId: string): string {
  return `${fromWarehouseId}:${toWarehouseId}`;
}

export interface LeadTimeObservationRow {
  observations: number;
  meanDays: number;
  stdDays: number | null;
  windowFrom: string;
  windowTo: string;
}
export interface LeadTimeRuleRow {
  leadTimeDays: number;
  leadTimeStdDays: number | null;
  coverDays: number;
  updatedAt: Date;
}
export interface SupplierRuleRow {
  supplierId: string;
  supplierName: string;
  defaultWarehouseId: string | null;
  rule: LeadTimeRuleRow | null;
  observation: LeadTimeObservationRow | null;
}
export interface RouteRuleRow {
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  rule: LeadTimeRuleRow | null;
  observation: LeadTimeObservationRow | null;
}
export interface SkuOverrideRow extends ReplenishmentSkuOverride {
  skuCode: string;
  skuName: string;
}

const GRADES: DemandGrade[] = ['A', 'B', 'C'];

/**
 * 규칙 4표 + 리드타임 프로필 2표 읽기 (스펙 §6). 쓰기는 Manager.
 *
 * 제안 계산이 쓰는 벌크 읽기(`readSupplierRules` · `readRouteRules` · `readSkuOverrides` ·
 * `searchSkuOverrides`)는 `tx` 를 **필수 첫 인자**로 받는다 — 한 제안 런의 모든 읽기가 같은
 * 스냅샷이어야 규칙이 런 중간에 갈리지 않는다(같은 이유로 A 의 `today` 도 한 번만 계산해 넘긴다).
 * 화면용 목록(`listGradeRules` · `listSupplierRows` · `listRouteRows`)만 `tx?` 다.
 */
@Injectable()
export class ReplenishmentRulesReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async readGradeAlphas(tx?: DbTx): Promise<Record<DemandGrade, number>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.replenishmentGradeRules);
      const byGrade = new Map(rows.map((r) => [r.grade, r.alpha]));
      const missing = GRADES.filter((g) => !byGrade.has(g));
      if (missing.length) {
        throw new Error(`replenishment_grade_rules 에 ${missing.join(', ')} 가 없다 — db:seed:ref 를 먼저 돌릴 것`);
      }
      return { A: byGrade.get('A') ?? 0, B: byGrade.get('B') ?? 0, C: byGrade.get('C') ?? 0 };
    }, tx);
  }

  listGradeRules(tx?: DbTx): Promise<ReplenishmentGradeRule[]> {
    return this.dbService.run(
      (trx) =>
        trx
          .select()
          .from(wmsTables.replenishmentGradeRules)
          .orderBy(asc(wmsTables.replenishmentGradeRules.grade)),
      tx,
    );
  }

  async readSupplierRules(tx: DbTx, supplierIds: string[]): Promise<Map<string, ReplenishmentSupplierRule>> {
    const unique = [...new Set(supplierIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(wmsTables.replenishmentSupplierRules)
        .where(inArray(wmsTables.replenishmentSupplierRules.supplierId, unique));
      return new Map(rows.map((r) => [r.supplierId, r]));
    }, tx);
  }

  async readRouteRules(tx: DbTx): Promise<Map<string, ReplenishmentRouteRule>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx.select().from(wmsTables.replenishmentRouteRules);
      return new Map(rows.map((r) => [routeKey(r.fromWarehouseId, r.toWarehouseId), r]));
    }, tx);
  }

  async readSkuOverrides(tx: DbTx, skuIds: string[]): Promise<Map<string, ReplenishmentSkuOverride>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(wmsTables.replenishmentSkuOverrides)
        .where(inArray(wmsTables.replenishmentSkuOverrides.skuId, unique));
      return new Map(rows.map((r) => [r.skuId, r]));
    }, tx);
  }

  /** 전 공급사 ← 규칙 ← 관측 프로필 left join, 이름순. 규칙 없는 공급사도 화면에 나와야 한다. */
  async listSupplierRows(tx?: DbTx): Promise<SupplierRuleRow[]> {
    return this.dbService.run(async (trx) => {
      const s = wmsTables.suppliers;
      const r = wmsTables.replenishmentSupplierRules;
      const p = wmsTables.supplierLeadTimeProfiles;
      const rows = await trx
        .select({
          supplierId: s.id,
          supplierName: s.name,
          defaultWarehouseId: s.defaultWarehouseId,
          ruleLeadTimeDays: r.leadTimeDays,
          ruleLeadTimeStdDays: r.leadTimeStdDays,
          ruleCoverDays: r.coverDays,
          ruleUpdatedAt: r.updatedAt,
          obsObservations: p.observations,
          obsMeanDays: p.meanDays,
          obsStdDays: p.stdDays,
          obsWindowFrom: p.windowFrom,
          obsWindowTo: p.windowTo,
        })
        .from(s)
        .leftJoin(r, eq(r.supplierId, s.id))
        .leftJoin(p, eq(p.supplierId, s.id))
        .orderBy(asc(s.name));
      return rows.map((row) => ({
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        defaultWarehouseId: row.defaultWarehouseId,
        rule:
          row.ruleLeadTimeDays === null || row.ruleCoverDays === null || row.ruleUpdatedAt === null
            ? null
            : {
                leadTimeDays: row.ruleLeadTimeDays,
                leadTimeStdDays: row.ruleLeadTimeStdDays,
                coverDays: row.ruleCoverDays,
                updatedAt: row.ruleUpdatedAt,
              },
        observation:
          row.obsObservations === null ||
          row.obsMeanDays === null ||
          row.obsWindowFrom === null ||
          row.obsWindowTo === null
            ? null
            : {
                observations: row.obsObservations,
                meanDays: row.obsMeanDays,
                stdDays: row.obsStdDays,
                windowFrom: row.obsWindowFrom,
                windowTo: row.obsWindowTo,
              },
      }));
    }, tx);
  }

  /**
   * 규칙 ∪ 관측 경로. 창고 쌍의 모집단이 두 표의 합집합이라 SQL 로는 FULL JOIN 이 되는데,
   * 두 표 다 (from, to) 쌍 단위로 작아서 메모리에서 합치는 편이 읽기 쉽다. 창고명도 여기서 붙인다.
   */
  async listRouteRows(tx?: DbTx): Promise<RouteRuleRow[]> {
    return this.dbService.run(async (trx) => {
      const rules = await trx.select().from(wmsTables.replenishmentRouteRules);
      const profiles = await trx.select().from(wmsTables.routeLeadTimeProfiles);
      const warehouses = await trx
        .select({ id: wmsTables.warehouses.id, name: wmsTables.warehouses.name })
        .from(wmsTables.warehouses);
      const nameOf = new Map(warehouses.map((w) => [w.id, w.name]));

      const merged = new Map<string, RouteRuleRow>();
      const ensure = (from: string, to: string): RouteRuleRow => {
        const key = routeKey(from, to);
        const existing = merged.get(key);
        if (existing) return existing;
        const row: RouteRuleRow = {
          fromWarehouseId: from,
          fromWarehouseName: nameOf.get(from) ?? from,
          toWarehouseId: to,
          toWarehouseName: nameOf.get(to) ?? to,
          rule: null,
          observation: null,
        };
        merged.set(key, row);
        return row;
      };
      for (const r of rules) {
        ensure(r.fromWarehouseId, r.toWarehouseId).rule = {
          leadTimeDays: r.leadTimeDays,
          leadTimeStdDays: r.leadTimeStdDays,
          coverDays: r.coverDays,
          updatedAt: r.updatedAt,
        };
      }
      for (const p of profiles) {
        ensure(p.fromWarehouseId, p.toWarehouseId).observation = {
          observations: p.observations,
          meanDays: p.meanDays,
          stdDays: p.stdDays,
          windowFrom: p.windowFrom,
          windowTo: p.windowTo,
        };
      }
      return [...merged.values()].sort(
        (a, b) =>
          a.fromWarehouseName.localeCompare(b.fromWarehouseName) || a.toWarehouseName.localeCompare(b.toWarehouseName),
      );
    }, tx);
  }

  /** 예외가 걸린 SKU 목록. q 는 SKU 코드 · 이름 부분 일치(대소문자 무시). */
  async searchSkuOverrides(tx: DbTx, q: string | undefined, limit: number): Promise<SkuOverrideRow[]> {
    return this.dbService.run(async (trx) => {
      const o = wmsTables.replenishmentSkuOverrides;
      const s = wmsTables.skus;
      const pattern = q && q.trim() ? `%${q.trim()}%` : null;
      const rows = await trx
        .select({ override: o, skuCode: s.code, skuName: s.name })
        .from(o)
        .innerJoin(s, eq(s.id, o.skuId))
        .where(pattern ? or(ilike(s.code, pattern), ilike(s.name, pattern)) : undefined)
        .orderBy(asc(s.code))
        .limit(limit);
      return rows.map((row) => ({ ...row.override, skuCode: row.skuCode, skuName: row.skuName }));
    }, tx);
  }

  /** upsert 직후 화면에 돌려줄 한 행 — 코드 · 이름을 붙여서. */
  async searchSkuOverridesById(tx: DbTx, skuId: string): Promise<SkuOverrideRow[]> {
    return this.dbService.run(async (trx) => {
      const o = wmsTables.replenishmentSkuOverrides;
      const s = wmsTables.skus;
      const rows = await trx
        .select({ override: o, skuCode: s.code, skuName: s.name })
        .from(o)
        .innerJoin(s, eq(s.id, o.skuId))
        .where(eq(o.skuId, skuId));
      return rows.map((row) => ({ ...row.override, skuCode: row.skuCode, skuName: row.skuName }));
    }, tx);
  }
}
