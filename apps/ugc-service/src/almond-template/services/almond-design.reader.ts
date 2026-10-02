import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { almondDesigns, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { type AlmondDesignPrintSource, type AlmondDesignView } from '../types/almond-design.types';

const viewColumns = {
  id: almondDesigns.id,
  userId: almondDesigns.userId,
  design: almondDesigns.design,
  templateId: almondDesigns.templateId,
  createdAt: almondDesigns.createdAt,
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

  async findPrintSource(id: string, tx?: UgcTx): Promise<AlmondDesignPrintSource> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ id: almondDesigns.id, frontSvg: almondDesigns.frontSvg, backSvg: almondDesigns.backSvg })
        .from(almondDesigns)
        .where(eq(almondDesigns.id, id))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond design not found: ${id}`);
      return row;
    }, tx);
  }
}
