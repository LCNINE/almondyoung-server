import { Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import {
  wmsSchema,
  wmsTables,
  DbTx,
  ReplenishmentGradeRule,
  ReplenishmentRouteRule,
  ReplenishmentSettings,
  ReplenishmentSkuOverride,
  ReplenishmentSupplierRule,
} from '../../schema/inventory.schema';
import { SETTINGS_KEY } from '../demand/replenishment-settings.reader';
import {
  GradeRuleDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../dto/replenishment-rules.dto';

/**
 * 규칙 쓰기 + 검증 (스펙 §6). 대상 마스터(공급사 · 창고 · SKU)가 없으면 404, 모순 입력은 400.
 *
 * 반영 시점이 규칙마다 다르다 — α · 리드타임 · 커버 · 예외는 제안이 읽는 시점에 계산되므로 저장 즉시,
 * 창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는 프로필을 바꾸므로 다음 야간 배치 또는
 * `POST /replenishment/profiles/recompute` 다. 화면이 항목마다 그 차이를 알린다.
 */
@Injectable()
export class ReplenishmentRulesManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async updateSettings(dto: UpdateReplenishmentSettingsDto, tx?: DbTx): Promise<ReplenishmentSettings> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentSettings;
      const [current] = await trx.select().from(t).where(eq(t.key, SETTINGS_KEY));
      if (!current) throw new Error('replenishment_settings 가 비어 있다 — db:seed:ref 를 먼저 돌릴 것');
      // 부분 갱신이라 한쪽만 보낸 요청도 저장된 반대쪽과 함께 봐야 한다 — A컷 ≥ B컷 이면 등급 A 가 사라진다.
      const aCut = dto.gradeACut ?? current.gradeACut;
      const bCut = dto.gradeBCut ?? current.gradeBCut;
      if (aCut >= bCut) throw new BadRequestError(`등급 컷은 A(${aCut}) < B(${bCut}) 여야 한다`);
      const [updated] = await trx
        .update(t)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(t.key, SETTINGS_KEY))
        .returning();
      return updated;
    }, tx);
  }

  async replaceGradeRules(items: GradeRuleDto[], tx?: DbTx): Promise<ReplenishmentGradeRule[]> {
    const grades = [...items.map((i) => i.grade)].sort().join('');
    if (grades !== 'ABC') throw new BadRequestError('등급 규칙은 A · B · C 세 행을 전부 보내야 한다');
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentGradeRules;
      const now = new Date();
      for (const item of items) {
        await trx
          .insert(t)
          .values({ grade: item.grade, alpha: item.alpha })
          .onConflictDoUpdate({ target: t.grade, set: { alpha: item.alpha, updatedAt: now } });
      }
      return trx.select().from(t);
    }, tx);
  }

  async upsertSupplierRule(
    supplierId: string,
    dto: UpsertLeadTimeRuleDto,
    tx?: DbTx,
  ): Promise<ReplenishmentSupplierRule> {
    return this.dbService.run(async (trx) => {
      const [supplier] = await trx
        .select({ id: wmsTables.suppliers.id })
        .from(wmsTables.suppliers)
        .where(eq(wmsTables.suppliers.id, supplierId));
      if (!supplier) throw new NotFoundError(`공급사 없음: ${supplierId}`);
      const t = wmsTables.replenishmentSupplierRules;
      const values = {
        supplierId,
        leadTimeDays: dto.leadTimeDays,
        leadTimeStdDays: dto.leadTimeStdDays ?? null,
        coverDays: dto.coverDays,
      };
      const [row] = await trx
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: t.supplierId, set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }, tx);
  }

  /** 규칙 행을 지우면 그 공급사는 전역 기본(default_lead_time_* · default_cover_days)으로 돌아간다. */
  async deleteSupplierRule(supplierId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentSupplierRules;
      const deleted = await trx.delete(t).where(eq(t.supplierId, supplierId)).returning({ id: t.supplierId });
      if (deleted.length === 0) throw new NotFoundError(`공급사 규칙 없음: ${supplierId}`);
    }, tx);
  }

  async upsertRouteRule(
    fromWarehouseId: string,
    toWarehouseId: string,
    dto: UpsertLeadTimeRuleDto,
    tx?: DbTx,
  ): Promise<ReplenishmentRouteRule> {
    if (fromWarehouseId === toWarehouseId) throw new BadRequestError('경로 규칙의 출발과 도착이 같은 창고일 수 없다');
    return this.dbService.run(async (trx) => {
      const w = wmsTables.warehouses;
      // 두 id 를 한 번에 조회한다 — 둘 다 있어야 2행이다(위에서 from ≠ to 를 이미 막았다).
      const found = await trx
        .select({ id: w.id })
        .from(w)
        .where(or(eq(w.id, fromWarehouseId), eq(w.id, toWarehouseId)));
      if (found.length !== 2) throw new NotFoundError(`창고 없음: ${fromWarehouseId} 또는 ${toWarehouseId}`);
      const t = wmsTables.replenishmentRouteRules;
      const values = {
        fromWarehouseId,
        toWarehouseId,
        leadTimeDays: dto.leadTimeDays,
        leadTimeStdDays: dto.leadTimeStdDays ?? null,
        coverDays: dto.coverDays,
      };
      const [row] = await trx
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: [t.fromWarehouseId, t.toWarehouseId], set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }, tx);
  }

  /** 규칙 행을 지우면 그 경로는 전역 이동 기본(default_transfer_*)으로 돌아간다. */
  async deleteRouteRule(fromWarehouseId: string, toWarehouseId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentRouteRules;
      const deleted = await trx
        .delete(t)
        .where(and(eq(t.fromWarehouseId, fromWarehouseId), eq(t.toWarehouseId, toWarehouseId)))
        .returning({ id: t.fromWarehouseId });
      if (deleted.length === 0) throw new NotFoundError(`경로 규칙 없음: ${fromWarehouseId} → ${toWarehouseId}`);
    }, tx);
  }

  async upsertSkuOverride(skuId: string, dto: UpsertSkuOverrideDto, tx?: DbTx): Promise<ReplenishmentSkuOverride> {
    return this.dbService.run(async (trx) => {
      const [sku] = await trx
        .select({ id: wmsTables.skus.id })
        .from(wmsTables.skus)
        .where(and(eq(wmsTables.skus.id, skuId), eq(wmsTables.skus.isDeleted, false)));
      if (!sku) throw new NotFoundError(`SKU 없음: ${skuId}`);
      const t = wmsTables.replenishmentSkuOverrides;
      const values = {
        skuId,
        mode: dto.mode,
        excludedUntil: dto.excludedUntil ?? null,
        safetyStock: dto.safetyStock ?? null,
        alpha: dto.alpha ?? null,
        memo: dto.memo ?? null,
      };
      const [row] = await trx
        .insert(t)
        .values(values)
        .onConflictDoUpdate({ target: t.skuId, set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }, tx);
  }

  /** 예외 행을 지우면 그 SKU 는 auto(등급 α · 계산된 안전재고)로 돌아간다. */
  async deleteSkuOverride(skuId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const t = wmsTables.replenishmentSkuOverrides;
      const deleted = await trx.delete(t).where(eq(t.skuId, skuId)).returning({ id: t.skuId });
      if (deleted.length === 0) throw new NotFoundError(`SKU 예외 없음: ${skuId}`);
    }, tx);
  }
}
