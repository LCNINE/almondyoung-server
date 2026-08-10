import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, asc, eq, gt, ilike, inArray, isNull, lte, or, SQL } from 'drizzle-orm';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { SitePopupEntity } from '../../schema/catalog.schema.types';
import { SitePopupListQueryDto } from './dto';
import { AUDIENCES_VISIBLE_TO, SitePopupViewerType } from './site-popup.constants';

@Injectable()
export class SitePopupReader {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async findById(id: string, tx?: DbTransaction): Promise<SitePopupEntity> {
    return this.db.run(async (trx) => {
      const popup = await this.findByIdOrNull(id, trx);

      if (!popup) {
        throw new NotFoundError(`Site popup not found: ${id}`);
      }

      return popup;
    }, tx);
  }

  async findByIdOrNull(id: string, tx?: DbTransaction): Promise<SitePopupEntity | null> {
    return this.db.run(async (trx) => {
      const [popup] = await trx
        .select()
        .from(pimSchema.sitePopups)
        .where(and(eq(pimSchema.sitePopups.id, id), isNull(pimSchema.sitePopups.deletedAt)))
        .limit(1);

      return popup ?? null;
    }, tx);
  }

  /** 관리자 목록 — 기본은 비활성 제외, includeInactive 로 전체 조회 */
  async findAll(query: SitePopupListQueryDto = {}, tx?: DbTransaction): Promise<SitePopupEntity[]> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [isNull(pimSchema.sitePopups.deletedAt)];

      if (query.isActive !== undefined) {
        conditions.push(eq(pimSchema.sitePopups.isActive, query.isActive));
      } else if (!query.includeInactive) {
        conditions.push(eq(pimSchema.sitePopups.isActive, true));
      }

      if (query.placement) {
        conditions.push(eq(pimSchema.sitePopups.placement, query.placement));
      }

      if (query.audience) {
        conditions.push(eq(pimSchema.sitePopups.audience, query.audience));
      }

      if (query.q?.trim()) {
        conditions.push(ilike(pimSchema.sitePopups.title, `%${query.q.trim()}%`));
      }

      return trx
        .select()
        .from(pimSchema.sitePopups)
        .where(and(...conditions))
        .orderBy(asc(pimSchema.sitePopups.sortOrder), asc(pimSchema.sitePopups.createdAt));
    }, tx);
  }

  /**
   * 스토어프론트용 — 활성 + 게시기간 내 + 방문자 구분에 맞는 팝업.
   *
   * placement 경로 매칭은 여기서 하지 않는다. 레이아웃 단위로 캐시되는 스토어프론트가
   * 경로별로 응답을 쪼개면 캐시 적중률만 떨어지고, 실제 경로는 클라이언트가 정확히 안다.
   */
  async findPublic(viewer: SitePopupViewerType, tx?: DbTransaction): Promise<SitePopupEntity[]> {
    return this.db.run(async (trx) => {
      const now = new Date();

      const conditions: SQL[] = [
        isNull(pimSchema.sitePopups.deletedAt),
        eq(pimSchema.sitePopups.isActive, true),
        inArray(pimSchema.sitePopups.audience, AUDIENCES_VISIBLE_TO[viewer]),
        or(isNull(pimSchema.sitePopups.displayStartAt), lte(pimSchema.sitePopups.displayStartAt, now))!,
        or(isNull(pimSchema.sitePopups.displayEndAt), gt(pimSchema.sitePopups.displayEndAt, now))!,
      ];

      return trx
        .select()
        .from(pimSchema.sitePopups)
        .where(and(...conditions))
        .orderBy(asc(pimSchema.sitePopups.sortOrder), asc(pimSchema.sitePopups.createdAt));
    }, tx);
  }

  /** 연결 대상 공지가 살아있는지 확인 (팝업 → 공지 링크 검증용) */
  async noticeExists(noticeId: string, tx?: DbTransaction): Promise<boolean> {
    return this.db.run(async (trx) => {
      const [notice] = await trx
        .select({ id: pimSchema.notices.id })
        .from(pimSchema.notices)
        .where(and(eq(pimSchema.notices.id, noticeId), isNull(pimSchema.notices.deletedAt)))
        .limit(1);

      return notice !== undefined;
    }, tx);
  }
}
