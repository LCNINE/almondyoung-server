import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { almondFonts, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { PublicFileClient } from '../clients/public-file.client';
import { type AlmondFontEntity } from '../types/almond-font.types';

@Injectable()
export class AlmondFontManager {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly files: PublicFileClient,
  ) {}

  // 라이선스 확인은 DTO 가 강제하고, 여기서는 그 확인 시각을 남긴다
  async create(fileId: string, name: string, userId: string, tx?: UgcTx): Promise<AlmondFontEntity> {
    const { format } = await this.files.fetchFont(fileId);
    if (!format) throw new BadRequestError('글꼴 파일이 아닙니다. TTF·OTF·WOFF·WOFF2 만 올릴 수 있습니다.');
    return this.db.run(async (trx) => {
      const [created] = await trx
        .insert(almondFonts)
        .values({ fileId, name: name.trim(), format, createdBy: userId, licenseConfirmedAt: new Date() })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ConflictError('이미 등록한 글꼴 파일입니다.');
      return created;
    }, tx);
  }

  // 목록에서만 숨긴다. 이미 이 글꼴을 쓴 시안은 fileId 로 계속 불러오고 인쇄한다
  async remove(id: string, userId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const deleted = await trx
        .update(almondFonts)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(and(eq(almondFonts.id, id), isNull(almondFonts.deletedAt)))
        .returning({ id: almondFonts.id });
      if (deleted.length === 0) throw new NotFoundError(`Almond font not found: ${id}`);
    }, tx);
  }
}
