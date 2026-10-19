import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { almondFonts, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { PublicFileClient } from '../clients/public-file.client';
import { type AlmondFontEntity } from '../types/almond-font.types';

const squash = (value: string) => value.replace(/\s/g, '').toLowerCase();

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
      // 같은 파일·같은 이름(띄어쓰기·대소문자 무시)은 DB 고유 인덱스가 막는다. 동시에 올려도 하나만 들어간다
      const [created] = await trx
        .insert(almondFonts)
        .values({ fileId, name: name.trim(), format, createdBy: userId, licenseConfirmedAt: new Date() })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [same] = await trx
        .select({ name: almondFonts.name })
        .from(almondFonts)
        .where(
          and(
            isNull(almondFonts.deletedAt),
            sql`lower(regexp_replace(${almondFonts.name}, '\\s', '', 'g')) = ${squash(name)}`,
          ),
        )
        .limit(1);
      throw new ConflictError(same ? `이미 있는 글꼴입니다. (${same.name})` : '이미 등록한 글꼴 파일입니다.');
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
