import { Inject, Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { shopListingImages, shopListings, type UgcServiceSchema, type UgcTx } from '../db/schema';
import {
  type AutoDecision,
  type AutoDecisionPolicy,
  CLASSIFIER_REJECT_REASON,
  classifySafely,
  decide,
  SHOP_LISTING_AUTO_DECISION_POLICY,
} from './classifier/auto-decision';
import {
  SHOP_LISTING_CLASSIFIER,
  type ShopListingClassifier,
  type ShopListingClassifierInput,
} from './classifier/shop-listing-classifier';
import { type AdminShopListingDto, type MemberShopListingDto } from './dto';
import { MEMBER_ACTIVE_LISTING_LIMIT, SHOP_LISTING_ADVISORY_LOCK_CLASS } from './shop-listing.constants';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingReader } from './shop-listing.reader';
import { entersLimit, nextStatus } from './shop-listing.transitions';
import { slugify } from './shop-listing.util';
import { type ShopListingEntity, type ShopListingWithImages } from './types';

type ListingFields = Pick<
  MemberShopListingDto,
  | 'title'
  | 'content'
  | 'region'
  | 'businessType'
  | 'dealType'
  | 'areaPyeong'
  | 'deposit'
  | 'monthlyRent'
  | 'keyMoney'
  | 'kakaoOpenChatUrl'
>;

@Injectable()
export class ShopListingManager {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly reader: ShopListingReader,
    private readonly moderation: ShopListingModerationManager,
    @Inject(SHOP_LISTING_CLASSIFIER) private readonly classifier: ShopListingClassifier,
    @Inject(SHOP_LISTING_AUTO_DECISION_POLICY) private readonly policy: AutoDecisionPolicy,
  ) {}

  // ─── 회원 ───

  async createByMember(dto: MemberShopListingDto, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    // 판정기는 트랜잭션 밖에서 부른다 — 외부 호출 동안 커넥션·락을 쥐지 않는다.
    const classification = await classifySafely(this.classifier, toClassifierInput(dto));
    const decision = decide(classification, this.policy);

    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      await this.assertWithinLimit(trx, userId);

      const [created] = await trx
        .insert(shopListings)
        .values({
          ...fieldsOf(dto),
          slug: await this.resolveSlug(dto.title, null, trx),
          contactPhone: dto.contactPhone,
          authorType: 'member',
          authorUserId: userId,
          updatedBy: userId,
          ...statusPatchFor(decision),
          submittedAt: new Date(),
        })
        .returning();

      await this.replaceImages(trx, created.id, dto.imageFileIds);
      await this.moderation.recordClassification(trx, created, classification, decision);
      return { ...created, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  async updateByMember(
    id: string,
    dto: MemberShopListingDto,
    userId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    const classification = await classifySafely(this.classifier, toClassifierInput(dto));
    const decision = decide(classification, this.policy);

    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      const current = await this.reader.findOwned(id, userId, trx);
      nextStatus(current.status, 'member_edit'); // hidden 이면 409

      if (entersLimit(current.status, decision)) {
        await this.assertWithinLimit(trx, userId);
      }

      // slug 는 바꾸지 않는다 — 이미 색인·공유된 URL 을 깨지 않는다.
      const updated = await this.moderation.updateStatusGuarded(trx, id, current.status, {
        ...fieldsOf(dto),
        contactPhone: dto.contactPhone,
        updatedBy: userId,
        ...statusPatchFor(decision),
        submittedAt: new Date(),
      });

      await this.replaceImages(trx, id, dto.imageFileIds);
      await this.moderation.recordClassification(trx, updated, classification, decision);
      return { ...updated, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  closeByMember(id: string, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.setDealStatusByMember(id, 'close', userId, tx);
  }

  reopenByMember(id: string, userId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.setDealStatusByMember(id, 'reopen', userId, tx);
  }

  async deleteByMember(id: string, userId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const now = new Date();
      const [deleted] = await trx
        .update(shopListings)
        .set({ ...CLEARED_CONTACT, deletedAt: now, deletedBy: userId, updatedAt: now })
        .where(and(eq(shopListings.id, id), eq(shopListings.authorUserId, userId), isNull(shopListings.deletedAt)))
        .returning({ id: shopListings.id });
      if (!deleted) throw new NotFoundError(`Shop listing not found: ${id}`);
    }, tx);
  }

  // ─── 관리자 ───

  async createByAdmin(dto: AdminShopListingDto, adminId: string, tx?: UgcTx): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const [created] = await trx
        .insert(shopListings)
        .values({
          ...fieldsOf(dto),
          slug: await this.resolveSlug(dto.slug || dto.title, null, trx),
          contactPhone: dto.contactPhone ?? null,
          authorType: 'admin',
          authorUserId: adminId,
          updatedBy: adminId,
          status: 'published',
        })
        .returning();

      await this.replaceImages(trx, created.id, dto.imageFileIds);
      return { ...created, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  /** 관리자 수정은 재검토하지 않는다 — 상태를 그대로 둔다. */
  async updateByAdmin(
    id: string,
    dto: AdminShopListingDto,
    adminId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findForAdmin(id, trx);
      const slug = dto.slug === undefined ? current.slug : await this.resolveSlug(dto.slug, id, trx);

      const [updated] = await trx
        .update(shopListings)
        .set({
          ...fieldsOf(dto),
          slug,
          contactPhone: dto.contactPhone ?? null,
          updatedBy: adminId,
          updatedAt: new Date(),
        })
        .where(and(eq(shopListings.id, id), isNull(shopListings.deletedAt)))
        .returning();
      if (!updated) throw new NotFoundError(`Shop listing not found: ${id}`);

      await this.replaceImages(trx, id, dto.imageFileIds);
      return { ...updated, imageFileIds: [...dto.imageFileIds] };
    }, tx);
  }

  /** 관리자는 한도에 걸리지 않는다. */
  async setDealStatusByAdmin(
    id: string,
    action: 'close' | 'reopen',
    adminId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      const current = await this.reader.findForAdmin(id, trx);
      const updated = await this.moderation.updateStatusGuarded(trx, id, current.status, {
        status: nextStatus(current.status, action),
        updatedBy: adminId,
      });
      return { ...updated, imageFileIds: current.imageFileIds };
    }, tx);
  }

  async deleteByAdmin(id: string, adminId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const now = new Date();
      const [deleted] = await trx
        .update(shopListings)
        .set({ ...CLEARED_CONTACT, deletedAt: now, deletedBy: adminId, updatedAt: now })
        .where(and(eq(shopListings.id, id), isNull(shopListings.deletedAt)))
        .returning({ id: shopListings.id });
      if (!deleted) throw new NotFoundError(`Shop listing not found: ${id}`);
    }, tx);
  }

  // ─── 탈퇴 ───

  /**
   * 탈퇴한 회원의 글: 연락처를 비우고 감춘다. 이미 지워진 글의 연락처도 비운다.
   * 멱등 — 재전송돼도 결과가 같다. 반환값은 이번에 새로 감춘 글 수.
   * 작성자 락을 먼저 잡는다 — 진행 중인 회원 작성·수정이 끝난 뒤에 감춰, 탈퇴 직후 커밋된 글이 살아남지 않게 한다.
   */
  async withdrawAuthor(userId: string, tx?: UgcTx): Promise<number> {
    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      const now = new Date();
      const hidden = await trx
        .update(shopListings)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(shopListings.authorUserId, userId),
            eq(shopListings.authorType, 'member'),
            isNull(shopListings.deletedAt),
          ),
        )
        .returning({ id: shopListings.id });

      await trx
        .update(shopListings)
        .set(CLEARED_CONTACT)
        .where(and(eq(shopListings.authorUserId, userId), eq(shopListings.authorType, 'member')));

      return hidden.length;
    }, tx);
  }

  // ─── 내부 ───

  private async setDealStatusByMember(
    id: string,
    action: 'close' | 'reopen',
    userId: string,
    tx?: UgcTx,
  ): Promise<ShopListingWithImages> {
    return this.db.run(async (trx) => {
      await this.lockAuthor(trx, userId);
      const current = await this.reader.findOwned(id, userId, trx);
      const status = nextStatus(current.status, action);
      if (entersLimit(current.status, status)) {
        await this.assertWithinLimit(trx, userId);
      }
      const updated = await this.moderation.updateStatusGuarded(trx, id, current.status, {
        status,
        updatedBy: userId,
      });
      return { ...updated, imageFileIds: current.imageFileIds };
    }, tx);
  }

  /** 같은 회원의 작성·재개를 직렬화한다. 트랜잭션이 끝나면 풀린다. */
  private async lockAuthor(trx: UgcTx, userId: string): Promise<void> {
    await trx.execute(sql`select pg_advisory_xact_lock(${SHOP_LISTING_ADVISORY_LOCK_CLASS}, hashtext(${userId}))`);
  }

  private async assertWithinLimit(trx: UgcTx, userId: string): Promise<void> {
    const active = await this.reader.countActiveByAuthor(userId, trx);
    if (active >= MEMBER_ACTIVE_LISTING_LIMIT) {
      throw new ConflictError(
        `검토 중이거나 게시 중인 매물은 ${MEMBER_ACTIVE_LISTING_LIMIT}건까지입니다. 거래완료 처리하거나 지운 뒤 다시 등록해 주세요.`,
      );
    }
  }

  private async replaceImages(trx: UgcTx, listingId: string, fileIds: string[]): Promise<void> {
    await trx.delete(shopListingImages).where(eq(shopListingImages.listingId, listingId));
    await trx.insert(shopListingImages).values(fileIds.map((fileId, order) => ({ listingId, fileId, order })));
  }

  private async resolveSlug(raw: string, excludeId: string | null, trx: UgcTx): Promise<string> {
    const base = slugify(raw);
    if (!base) {
      throw new BadRequestError('주소를 만들 수 없습니다. 제목에 한글이나 영문을 넣어주세요.');
    }
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      if (!(await this.reader.slugTaken(candidate, excludeId, trx))) return candidate;
    }
    throw new ConflictError(`같은 주소가 너무 많습니다: ${base}`);
  }
}

const CLEARED_CONTACT = { contactPhone: null, kakaoOpenChatUrl: null } as const;

function fieldsOf(dto: ListingFields): Pick<
  ShopListingEntity,
  | 'title'
  | 'content'
  | 'region'
  | 'businessType'
  | 'dealType'
  | 'areaPyeong'
  | 'deposit'
  | 'monthlyRent'
  | 'keyMoney'
  | 'kakaoOpenChatUrl'
> {
  return {
    title: dto.title.trim(),
    content: dto.content,
    region: dto.region,
    businessType: dto.businessType,
    dealType: dto.dealType,
    areaPyeong: dto.areaPyeong ?? null,
    deposit: dto.deposit ?? null,
    monthlyRent: dto.monthlyRent ?? null,
    keyMoney: dto.keyMoney ?? null,
    kakaoOpenChatUrl: dto.kakaoOpenChatUrl ?? null,
  };
}

function statusPatchFor(decision: AutoDecision): Pick<ShopListingEntity, 'status' | 'rejectReason'> {
  return { status: decision, rejectReason: decision === 'rejected' ? CLASSIFIER_REJECT_REASON : null };
}

function toClassifierInput(dto: ListingFields): ShopListingClassifierInput {
  return {
    title: dto.title,
    content: dto.content,
    region: dto.region,
    businessType: dto.businessType,
    dealType: dto.dealType,
    deposit: dto.deposit ?? null,
    monthlyRent: dto.monthlyRent ?? null,
    keyMoney: dto.keyMoney ?? null,
  };
}
