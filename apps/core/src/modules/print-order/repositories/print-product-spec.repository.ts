import { Injectable } from '@nestjs/common';
import { DbService, type AnyTx } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { type PrintProductSpecRow } from '../schema/print-order.schema';
import { type WowpressLineSpec } from '../wowpress/wowpress.types';

export type ClaimTemplateResult = { claimed: true } | { claimed: false; masterId: string };

export function rowToSpec(row: PrintProductSpecRow): WowpressLineSpec {
  return {
    prodno: row.prodno,
    jobpresetno: row.jobpresetno,
    prsjob: row.prsjob,
    awkjob: row.awkjob,
    qtyPerUnit: row.qtyPerUnit,
    file: { format: row.fileFormat, dpi: row.fileDpi },
    design: { productId: row.designProductId, widthMm: row.designWidthMm, heightMm: row.designHeightMm },
    confirmed: row.confirmed,
  };
}

export function specToRow(variantId: string, spec: WowpressLineSpec) {
  return {
    variantId,
    prodno: spec.prodno,
    jobpresetno: spec.jobpresetno,
    prsjob: spec.prsjob,
    awkjob: spec.awkjob,
    qtyPerUnit: spec.qtyPerUnit,
    fileFormat: spec.file.format,
    fileDpi: spec.file.dpi,
    designProductId: spec.design.productId,
    designWidthMm: spec.design.widthMm,
    designHeightMm: spec.design.heightMm,
    confirmed: spec.confirmed,
  };
}

@Injectable()
export class PrintProductSpecRepository {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  findSpec(variantId: string, tx?: DbTx): Promise<WowpressLineSpec | null> {
    const t = wmsTables.printProductSpecs;

    return this.dbService.run(async (trx) => {
      const [row] = await trx.select().from(t).where(eq(t.variantId, variantId)).limit(1);

      return row ? rowToSpec(row) : null;
    }, tx);
  }

  async insertSpecs(rows: { variantId: string; spec: WowpressLineSpec }[], tx: AnyTx): Promise<void> {
    if (rows.length === 0) return;

    // 게시 트랜잭션이 여러 BC 에 걸치므로 AnyTx 로 받아 여기서 한 번만 좁힌다
    await this.dbService.run(async (trx) => {
      await trx.insert(wmsTables.printProductSpecs).values(rows.map((r) => specToRow(r.variantId, r.spec)));
    }, tx as DbTx);
  }

  async claimTemplate(templateId: string, masterId: string, tx: AnyTx): Promise<ClaimTemplateResult> {
    const t = wmsTables.printTemplateProducts;

    // 게시 트랜잭션이 여러 BC 에 걸치므로 AnyTx 로 받아 여기서 한 번만 좁힌다
    return this.dbService.run(async (trx): Promise<ClaimTemplateResult> => {
      const inserted = await trx
        .insert(t)
        .values({ templateId, masterId })
        .onConflictDoNothing()
        .returning({ id: t.templateId });

      if (inserted.length > 0) return { claimed: true };

      const [existing] = await trx
        .select({ masterId: t.masterId })
        .from(t)
        .where(eq(t.templateId, templateId))
        .limit(1);

      if (!existing) throw new Error(`print template claim vanished: ${templateId}`);

      return { claimed: false, masterId: existing.masterId };
    }, tx as DbTx);
  }

  async assignClaimedMaster(templateId: string, masterId: string, tx: AnyTx): Promise<void> {
    const t = wmsTables.printTemplateProducts;

    // 게시 트랜잭션이 여러 BC 에 걸치므로 AnyTx 로 받아 여기서 한 번만 좁힌다
    await this.dbService.run(async (trx) => {
      await trx.update(t).set({ masterId }).where(eq(t.templateId, templateId));
    }, tx as DbTx);
  }

  confirmVariant(variantId: string, actorId: string, tx?: DbTx): Promise<void> {
    const t = wmsTables.printProductSpecs;

    return this.dbService.run(async (trx) => {
      await trx
        .update(t)
        .set({ confirmed: true, confirmedAt: new Date(), confirmedBy: actorId, updatedAt: new Date() })
        .where(eq(t.variantId, variantId));
    }, tx);
  }
}
