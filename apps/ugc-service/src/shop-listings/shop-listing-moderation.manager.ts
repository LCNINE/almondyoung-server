import { Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { shopListingModerations, shopListings, type UgcServiceSchema, type UgcTx } from '../db/schema';
import { type AutoDecision } from './classifier/auto-decision';
import { type ShopListingClassification } from './classifier/shop-listing-classifier';
import { type ShopListingModerationDecision, type ShopListingStatus } from './shop-listing.constants';
import { ShopListingReader } from './shop-listing.reader';
import { nextStatus, type ShopListingAction } from './shop-listing.transitions';
import { type ShopListingEntity, type ShopListingInsert, type ShopListingWithImages } from './types';

type AdminModerationAction = Extract<ShopListingAction, 'approve' | 'reject' | 'hide' | 'unhide'>;

const DECISION_OF: Record<AdminModerationAction, ShopListingModerationDecision> = {
  approve: 'approved',
  reject: 'rejected',
  hide: 'hidden',
  unhide: 'unhidden',
};

const AUTO_DECISION_OF: Record<AutoDecision, ShopListingModerationDecision> = {
  published: 'approved',
  rejected: 'rejected',
  pending: 'pending',
};

@Injectable()
export class ShopListingModerationManager {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly reader: ShopListingReader,
  ) {}

  /**
   * `expectedSubmittedAt` 은 관리자가 화면에서 본 판의 제출 시각이다. 주면 지금 글과 대조해 다르면 409 —
   * 본 적 없는 판을 승인하지 않게 한다. 안 줘도 UPDATE 가 읽은 판의 submitted_at 으로 CAS 한다.
   */
  approve(id: string, adminId: string, expectedSubmittedAt?: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'approve', adminId, null, expectedSubmittedAt, tx);
  }

  reject(
    id: string,
    reason: string,
    adminId: string,
    expectedSubmittedAt?: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.moderate(id, 'reject', adminId, reason.trim(), expectedSubmittedAt, tx);
  }

  hide(id: string, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'hide', adminId, null, undefined, tx);
  }

  unhide(id: string, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.moderate(id, 'unhide', adminId, null, undefined, tx);
  }

  /** 판정기 결과를 이력에 남긴다. 결과가 없으면(= v1 NullClassifier·장애) 남길 것이 없다. */
  async recordClassification(
    trx: UgcTx,
    listing: Pick<ShopListingEntity, 'id' | 'title' | 'content'>,
    result: ShopListingClassification | null,
    decision: AutoDecision,
  ): Promise<void> {
    if (!result) return;
    await trx.insert(shopListingModerations).values({
      listingId: listing.id,
      decidedBy: 'classifier',
      decision: AUTO_DECISION_OF[decision],
      label: result.label,
      confidence: result.confidence,
      titleSnapshot: listing.title,
      contentSnapshot: listing.content,
    });
  }

  /**
   * 상태를 읽은 값 그대로일 때만 바꾼다(CAS). 관리자 판정과 회원 수정이 겹치면 늦은 쪽이 409 를 받는다.
   * advisory lock 은 작성자 단위라 관리자 동작을 막지 못하므로 이 가드가 필요하다.
   *
   * 회원이 pending 글을 고치면 상태는 pending → pending 이라 status 만으로는 못 가린다. 승인·거절은
   * `opts.submittedAt` 으로 읽은 판의 제출 시각까지 대조해, 그사이 고쳐진 글을 검토 없이 게시하지 않는다.
   */
  async updateStatusGuarded(
    trx: UgcTx,
    id: string,
    expected: ShopListingStatus,
    patch: Partial<ShopListingInsert>,
    opts?: { submittedAt?: Date | null },
  ): Promise<ShopListingEntity> {
    const conditions: SQL[] = [eq(shopListings.id, id), eq(shopListings.status, expected), isNull(shopListings.deletedAt)];
    if (opts && opts.submittedAt !== undefined) {
      conditions.push(
        opts.submittedAt === null ? isNull(shopListings.submittedAt) : eq(shopListings.submittedAt, opts.submittedAt),
      );
    }
    const [updated] = await trx
      .update(shopListings)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!updated) {
      throw new ConflictError('글의 상태가 그사이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.');
    }
    return updated;
  }

  private moderate(
    id: string,
    action: AdminModerationAction,
    adminId: string,
    reason: string | null,
    expectedSubmittedAt: string | undefined,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findForAdmin(id, trx);
      const status = nextStatus(current.status, action);
      const reviewsContent = action === 'approve' || action === 'reject';
      if (reviewsContent && expectedSubmittedAt !== undefined) {
        this.assertSameRevision(current.submittedAt, expectedSubmittedAt);
      }

      const updated = await this.updateStatusGuarded(
        trx,
        id,
        current.status,
        {
          status,
          updatedBy: adminId,
          ...(action === 'reject' ? { rejectReason: reason } : {}),
        },
        reviewsContent ? { submittedAt: current.submittedAt } : undefined,
      );

      await trx.insert(shopListingModerations).values({
        listingId: id,
        decidedBy: 'admin',
        decision: DECISION_OF[action],
        reason,
        actorUserId: adminId,
        titleSnapshot: current.title,
        contentSnapshot: current.content,
      });

      return { ...updated, imageFileIds: current.imageFileIds };
    }, tx);
  }

  private assertSameRevision(current: Date | null, expectedIso: string): void {
    if (current === null || current.getTime() !== new Date(expectedIso).getTime()) {
      throw new ConflictError('검토 중에 글이 수정됐습니다. 새로고침 후 다시 확인해 주세요.');
    }
  }
}
