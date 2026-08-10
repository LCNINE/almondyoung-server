import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction, NewSitePopup } from '../../catalog.types';
import { SitePopupEntity } from '../../schema/catalog.schema.types';
import { CreateSitePopupDto, UpdateSitePopupDto } from './dto';
import { SitePopupReader } from './site-popup.reader';
import {
  SitePopupAudience,
  SitePopupContentType,
  SitePopupDismissMode,
  SitePopupPlacement,
} from './site-popup.constants';

/** 검증에 쓰는, 생성/수정 후의 최종 형태 */
type ResolvedPopup = {
  contentType: SitePopupContentType;
  content: string | null;
  pcImageFileId: string | null;
  mobileImageFileId: string | null;
  linkUrl: string | null;
  noticeId: string | null;
  placement: SitePopupPlacement;
  placementPaths: string[];
  audience: SitePopupAudience;
  dismissMode: SitePopupDismissMode;
  dismissDays: number | null;
  displayStartAt: Date | null;
  displayEndAt: Date | null;
};

@Injectable()
export class SitePopupManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: SitePopupReader,
  ) {}

  async create(dto: CreateSitePopupDto, actorId?: string, tx?: DbTransaction): Promise<SitePopupEntity> {
    return this.db.run(async (trx) => {
      const resolved: ResolvedPopup = {
        contentType: dto.contentType ?? 'rich_text',
        content: dto.content ?? null,
        pcImageFileId: dto.pcImageFileId ?? null,
        mobileImageFileId: dto.mobileImageFileId ?? null,
        linkUrl: dto.linkUrl ?? null,
        noticeId: dto.noticeId ?? null,
        placement: dto.placement ?? 'main',
        placementPaths: normalizePaths(dto.placementPaths ?? []),
        audience: dto.audience ?? 'all',
        dismissMode: dto.dismissMode ?? 'today',
        dismissDays: dto.dismissDays ?? null,
        displayStartAt: toDate(dto.displayStartAt),
        displayEndAt: toDate(dto.displayEndAt),
      };

      await this.assertValid(resolved, trx);

      const values: NewSitePopup = {
        title: dto.title,
        imageAlt: dto.imageAlt ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: actorId,
        updatedBy: actorId,
        ...resolved,
      };

      const [created] = await trx.insert(pimSchema.sitePopups).values(values).returning();

      if (!created) {
        throw new Error('Site popup insert returned no row');
      }

      return created;
    }, tx);
  }

  async update(
    id: string,
    dto: UpdateSitePopupDto,
    actorId?: string,
    tx?: DbTransaction,
  ): Promise<SitePopupEntity> {
    return this.db.run(async (trx) => {
      const existing = await this.reader.findById(id, trx);

      // 부분 수정이라도 "수정 후의 팝업"이 성립하는지 봐야 한다. 예를 들어 본문형을
      // 이미지형으로만 바꾸면 이미지가 비어 렌더 불가능한 팝업이 저장될 수 있다.
      const resolved: ResolvedPopup = {
        contentType: dto.contentType ?? (existing.contentType as SitePopupContentType),
        content: pick(dto, 'content', existing.content),
        pcImageFileId: pick(dto, 'pcImageFileId', existing.pcImageFileId),
        mobileImageFileId: pick(dto, 'mobileImageFileId', existing.mobileImageFileId),
        linkUrl: pick(dto, 'linkUrl', existing.linkUrl),
        noticeId: pick(dto, 'noticeId', existing.noticeId),
        placement: dto.placement ?? (existing.placement as SitePopupPlacement),
        placementPaths: normalizePaths(dto.placementPaths ?? existing.placementPaths ?? []),
        audience: dto.audience ?? (existing.audience as SitePopupAudience),
        dismissMode: dto.dismissMode ?? (existing.dismissMode as SitePopupDismissMode),
        dismissDays: pick(dto, 'dismissDays', existing.dismissDays),
        displayStartAt:
          dto.displayStartAt === undefined ? existing.displayStartAt : toDate(dto.displayStartAt),
        displayEndAt: dto.displayEndAt === undefined ? existing.displayEndAt : toDate(dto.displayEndAt),
      };

      await this.assertValid(resolved, trx);

      const [updated] = await trx
        .update(pimSchema.sitePopups)
        .set({
          ...resolved,
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.imageAlt !== undefined ? { imageAlt: dto.imageAlt } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(and(eq(pimSchema.sitePopups.id, id), isNull(pimSchema.sitePopups.deletedAt)))
        .returning();

      if (!updated) {
        throw new NotFoundError(`Site popup not found: ${id}`);
      }

      return updated;
    }, tx);
  }

  /**
   * 숨김 초기화 — 이미 "다시 보지 않기" 를 누른 방문자에게도 다시 노출한다.
   * 내용을 고칠 때마다 강제 재노출하면 오타 수정에도 팝업이 다시 떠서 성가시므로,
   * 재노출은 관리자가 명시적으로 누를 때만 일어난다.
   */
  async resetDismissals(id: string, actorId?: string, tx?: DbTransaction): Promise<SitePopupEntity> {
    return this.db.run(async (trx) => {
      const [updated] = await trx
        .update(pimSchema.sitePopups)
        .set({
          dismissVersion: sql`${pimSchema.sitePopups.dismissVersion} + 1`,
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(and(eq(pimSchema.sitePopups.id, id), isNull(pimSchema.sitePopups.deletedAt)))
        .returning();

      if (!updated) {
        throw new NotFoundError(`Site popup not found: ${id}`);
      }

      return updated;
    }, tx);
  }

  async softDelete(id: string, actorId?: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (trx) => {
      const now = new Date();

      const [deleted] = await trx
        .update(pimSchema.sitePopups)
        .set({ deletedAt: now, deletedBy: actorId, isActive: false, updatedAt: now })
        .where(and(eq(pimSchema.sitePopups.id, id), isNull(pimSchema.sitePopups.deletedAt)))
        .returning({ id: pimSchema.sitePopups.id });

      if (!deleted) {
        throw new NotFoundError(`Site popup not found: ${id}`);
      }
    }, tx);
  }

  /** 저장 전에 "실제로 렌더 가능한 팝업인가" 를 확인한다. */
  private async assertValid(popup: ResolvedPopup, tx: DbTransaction): Promise<void> {
    if (popup.contentType === 'rich_text' && isBlankHtml(popup.content)) {
      throw new BadRequestError('본문형 팝업은 본문이 비어 있을 수 없습니다.');
    }

    if (popup.contentType === 'image' && !popup.pcImageFileId) {
      throw new BadRequestError('이미지형 팝업은 PC 이미지가 필요합니다.');
    }

    if (popup.placement === 'paths' && popup.placementPaths.length === 0) {
      throw new BadRequestError('노출 경로를 하나 이상 입력해 주세요.');
    }

    if (popup.placement === 'paths' && popup.placementPaths.some((path) => !path.startsWith('/'))) {
      throw new BadRequestError('노출 경로는 "/" 로 시작해야 합니다.');
    }

    if (popup.dismissMode === 'days' && (popup.dismissDays === null || popup.dismissDays < 1)) {
      throw new BadRequestError('숨김 일수를 1일 이상으로 입력해 주세요.');
    }

    if (popup.displayStartAt && popup.displayEndAt && popup.displayEndAt <= popup.displayStartAt) {
      throw new BadRequestError('게시 종료 일시는 시작 일시보다 뒤여야 합니다.');
    }

    if (popup.linkUrl && !isSafeLink(popup.linkUrl)) {
      throw new BadRequestError('링크는 http(s) 주소이거나 "/" 로 시작하는 사이트 내 경로여야 합니다.');
    }

    if (popup.noticeId && !(await this.reader.noticeExists(popup.noticeId, tx))) {
      throw new BadRequestError(`연결할 공지사항을 찾을 수 없습니다: ${popup.noticeId}`);
    }
  }
}

/** 값을 명시적으로 null 로 보내면 비우고, 생략하면 기존 값을 유지한다. */
function pick<K extends keyof UpdateSitePopupDto, V>(
  dto: UpdateSitePopupDto,
  key: K,
  fallback: V,
): NonNullable<UpdateSitePopupDto[K]> | V | null {
  const value = dto[key];
  if (value === undefined) return fallback;
  return value === null ? null : (value as NonNullable<UpdateSitePopupDto[K]>);
}

function toDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

function normalizePaths(paths: string[]): string[] {
  const trimmed = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  return [...new Set(trimmed)];
}

/** 태그만 남은 에디터 출력(<p></p> 등)을 빈 본문으로 본다. */
function isBlankHtml(html: string | null): boolean {
  if (!html) return true;
  const withoutTags = html
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ');
  return withoutTags.trim().length === 0;
}

/** javascript: 등 위험한 스킴을 막는다. 사이트 내 경로도 허용. */
function isSafeLink(url: string): boolean {
  const value = url.trim();
  if (value.startsWith('/')) return !value.startsWith('//');
  return /^https?:\/\//i.test(value);
}
