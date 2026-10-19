import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { asc, isNull } from 'drizzle-orm';
import { almondFonts, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { type AlmondFontEntity } from '../types/almond-font.types';

@Injectable()
export class AlmondFontReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  listActive(tx?: UgcTx): Promise<AlmondFontEntity[]> {
    return this.db.run(
      (trx) => trx.select().from(almondFonts).where(isNull(almondFonts.deletedAt)).orderBy(asc(almondFonts.name)),
      tx,
    );
  }
}
