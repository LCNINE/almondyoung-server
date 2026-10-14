import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { almondDesigns, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { ALMOND_PRINT_FILE_SCALE } from '../constants/almond-template.constants';
import { toFileScale } from '../print/almond-print-svg';
import { type AlmondDesignInfo, type AlmondDesignPrintSource, type AlmondDesignView } from '../types/almond-design.types';

const viewColumns = {
  id: almondDesigns.id,
  userId: almondDesigns.userId,
  design: almondDesigns.design,
  templateId: almondDesigns.templateId,
  createdAt: almondDesigns.createdAt,
  hasBack: sql<boolean>`${almondDesigns.backSvg} is not null`,
};

@Injectable()
export class AlmondDesignReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async findOwned(id: string, userId: string, tx?: UgcTx): Promise<AlmondDesignView> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select(viewColumns)
        .from(almondDesigns)
        .where(and(eq(almondDesigns.id, id), eq(almondDesigns.userId, userId)))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond design not found: ${id}`);
      return row;
    }, tx);
  }

  async findById(id: string, tx?: UgcTx): Promise<AlmondDesignView> {
    return this.db.run(async (trx) => {
      const [row] = await trx.select(viewColumns).from(almondDesigns).where(eq(almondDesigns.id, id)).limit(1);
      if (!row) throw new NotFoundError(`Almond design not found: ${id}`);
      return row;
    }, tx);
  }

  async findInfo(id: string, tx?: UgcTx): Promise<AlmondDesignInfo> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({
          id: almondDesigns.id,
          productId: almondDesigns.productId,
          widthMm: almondDesigns.widthMm,
          heightMm: almondDesigns.heightMm,
          hasBack: viewColumns.hasBack,
        })
        .from(almondDesigns)
        .where(eq(almondDesigns.id, id))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond design not found: ${id}`);
      return row;
    }, tx);
  }

  async findPrintSource(id: string, tx?: UgcTx): Promise<AlmondDesignPrintSource> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({
          id: almondDesigns.id,
          frontSvg: almondDesigns.frontSvg,
          backSvg: almondDesigns.backSvg,
          widthMm: almondDesigns.widthMm,
          kind: sql<string | null>`${almondDesigns.design}->>'kind'`,
        })
        .from(almondDesigns)
        .where(eq(almondDesigns.id, id))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond design not found: ${id}`);
      const scale = ALMOND_PRINT_FILE_SCALE[row.kind ?? ''] ?? 1;
      return {
        id: row.id,
        frontSvg: toFileScale(row.frontSvg, row.widthMm, scale),
        backSvg: row.backSvg === null ? null : toFileScale(row.backSvg, row.widthMm, scale),
      };
    }, tx);
  }

  async findPrintFiles(id: string, tx?: UgcTx): Promise<Record<string, string>> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ printFiles: almondDesigns.printFiles })
        .from(almondDesigns)
        .where(eq(almondDesigns.id, id))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond design not found: ${id}`);
      return row.printFiles;
    }, tx);
  }
}
