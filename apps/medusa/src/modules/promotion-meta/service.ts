import type { Context } from '@medusajs/framework/types';
import { InjectTransactionManager, MedusaContext, MedusaService } from '@medusajs/framework/utils';
import type { EntityManager } from '@mikro-orm/knex';
import PromotionMeta from './models/promotion-meta';
import CouponEvent from './models/coupon-event';
import CouponEventItem from './models/coupon-event-item';
import CouponGrant from './models/coupon-grant';

// 쿠폰 어휘(`AutoIssueTrigger` · `PromotionMetaData.visibility`)는 이 트리 밖에도 사본이 있다.
// 값을 늘리거나 줄이면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 빨개지며
// 함께 고쳐야 할 곳을 전부 이름으로 지목한다(마이그레이션 CHECK 제약 포함).
// `visibility` 의 타입 정본은 `@packages/domain-types` 에 있으나 **여기서 import 할 수 없다**
// — Medusa 빌드에는 번들러가 없어 `@packages/*` 별칭이 런타임에 해석되지 않는다.
export type AutoIssueTrigger = 'customer_registered' | 'membership_activated';
export type AdminIssueTrigger = 'admin_manual' | 'admin_force' | 'customer_claim';
export type IssueTrigger = AutoIssueTrigger | AdminIssueTrigger;

export type PromotionMetaData = {
  promotion_id: string;
  name?: string | null;
  max_discount_amount?: number | null;
  created_by?: string | null;
  visibility?: 'public' | 'claimable' | 'assigned_only' | null;
  max_claims?: number | null;
  auto_issue_trigger?: AutoIssueTrigger | null;
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  validity_days?: number | null;
};

/** `coupon_grant` 한 행. 숫자·날짜가 DB 에서 문자열로 오는 경우가 있어 union 이다. */
export type CouponGrantRow = {
  id: string;
  promotion_id: string;
  customer_id: string;
  issue_key: string;
  issued_via: IssueTrigger;
  issued_at: Date | string;
  expires_at: Date | string | null;
  used_at: Date | string | null;
  order_id: string | null;
};

/** `issueGrantWithSlot` 의 입력. 공개 메서드와 트랜잭션 본체가 같은 모양을 공유한다. */
export type IssueGrantWithSlotInput = {
  promotion_id: string;
  customer_id: string;
  issue_key: string;
  issued_via: IssueTrigger;
  expires_at: Date | null;
  now: Date;
  /** 이 프로모션의 발급 상한. `null` 이면 상한 없음 — 카운터를 건드리지 않는다. */
  max_claims: number | null;
  /** 상한을 **집행**할 것인가. admin force 는 `false` 지만 발급 수에는 여전히 포함된다. */
  enforce_cap: boolean;
};

/**
 * `issueGrantWithSlot_` 내부 신호. 트랜잭션 «안»에서 유니크 위반을 잡아 그냥 반환하면 안 된다 —
 * Postgres 는 제약 위반이 나는 순간 트랜잭션을 aborted 상태로 만들어, 그 뒤의 어떤 문장도
 * 받지 않는다(슬롯 증가를 되돌리는 UPDATE 도 포함). 그래서 되감기는 트랜잭션 자체에 맡기고,
 * 바깥에서 이 신호를 잡아 `'duplicate'` 로 바꾼다.
 */
class DuplicateGrantSignal extends Error {}

/** 같은 목적의 소진 신호. 슬롯을 못 잡으면 앞서 넣은 장까지 함께 되감아야 한다. */
class ExhaustedSignal extends Error {}

class PromotionMetaModuleService extends MedusaService({
  PromotionMeta,
  CouponEvent,
  CouponEventItem,
  CouponGrant,
}) {
  async upsert(data: PromotionMetaData): Promise<any> {
    if (data.visibility != null && !['public', 'claimable', 'assigned_only'].includes(data.visibility)) {
      throw new Error(`Invalid visibility value: ${data.visibility}`);
    }
    if (data.auto_issue_trigger != null && !['customer_registered', 'membership_activated'].includes(data.auto_issue_trigger)) {
      throw new Error(`Invalid auto_issue_trigger value: ${data.auto_issue_trigger}`);
    }
    if (data.validity_days != null) {
      const n = Number(data.validity_days);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid validity_days value: ${data.validity_days}`);
      }
    }
    const existing = await (this as any).listPromotionMetas({ promotion_id: data.promotion_id });
    if (existing.length > 0) {
      return (this as any).updatePromotionMetas({ id: existing[0].id, ...data });
    }
    return (this as any).createPromotionMetas(data);
  }

  async getByPromotionId(promotionId: string): Promise<any | null> {
    const records = await (this as any).listPromotionMetas({ promotion_id: promotionId });
    return records[0] ?? null;
  }

  async getByPromotionIds(promotionIds: string[]): Promise<any[]> {
    if (!promotionIds.length) return [];
    return (this as any).listPromotionMetas({ promotion_id: { $in: promotionIds } });
  }

  async getByAutoIssueTrigger(trigger: AutoIssueTrigger): Promise<any[]> {
    return (this as any).listPromotionMetas({ auto_issue_trigger: trigger });
  }

  async deleteByPromotionId(promotionId: string): Promise<void> {
    const existing = await (this as any).listPromotionMetas({ promotion_id: promotionId });
    if (existing.length > 0) {
      await (this as any).deletePromotionMetas([existing[0].id]);
    }
  }

  /**
   * 슬롯 하나를 원자적으로 예약한다. `UPDATE ... WHERE issued_count < maxClaims` 라서 동시
   * 요청이 상한을 넘기지 못한다. 마이그레이션 이전에 발급된 프로모션은 `issued_count` 가 0 이니
   * `backfill:issued-count` 로 실제 발급 수를 채운 뒤에 상한이 의미를 갖는다.
   *
   * `sharedContext` 를 받는 이유: `issueGrantWithSlot_` 이 자기 트랜잭션 안에서 이것을 부른다.
   * 넘기지 않으면 저장소의 기본 매니저로 떨어져 **다른 트랜잭션**에서 카운터를 올리게 되고,
   * 장 INSERT 가 되감겨도 카운터만 남는다. 같은 SQL 을 두 벌로 복제하지 않으려고 이 한
   * 인자를 열어 둔다.
   */
  async reserveClaimSlot(
    promotionId: string,
    maxClaims: number,
    sharedContext?: Context<EntityManager>,
  ): Promise<'ok' | 'exhausted'> {
    const result = await this.txEm(sharedContext).execute(
      `UPDATE "promotion_meta" SET "issued_count" = "issued_count" + 1
       WHERE "promotion_id" = ? AND "issued_count" < ?
       RETURNING "id"`,
      [promotionId, maxClaims],
    );
    return (result?.length ?? 0) > 0 ? 'ok' : 'exhausted';
  }

  async releaseClaimSlot(promotionId: string, sharedContext?: Context<EntityManager>): Promise<void> {
    await this.txEm(sharedContext).execute(
      `UPDATE "promotion_meta" SET "issued_count" = GREATEST("issued_count" - 1, 0)
       WHERE "promotion_id" = ?`,
      [promotionId],
    );
  }

  /** 상한을 집행하지 않고 발급 수만 올린다 (admin force). 위와 같은 이유로 컨텍스트를 받는다. */
  async incrementIssuedCount(promotionId: string, sharedContext?: Context<EntityManager>): Promise<void> {
    await this.txEm(sharedContext).execute(
      `UPDATE "promotion_meta" SET "issued_count" = "issued_count" + 1 WHERE "promotion_id" = ?`,
      [promotionId],
    );
  }

  /** issued_count 를 실제 링크 수로 정합화(backfill). 음수는 0으로 보정. */
  async setIssuedCount(promotionId: string, count: number): Promise<void> {
    const safe = Math.max(0, Math.floor(count));
    const em = (this as any).baseRepository_.manager_;
    await em.execute(
      `UPDATE "promotion_meta" SET "issued_count" = ? WHERE "promotion_id" = ?`,
      [safe, promotionId],
    );
  }

  /*───────────────────────────
   * 쿠폰 이벤트 (배너용 쿠폰 묶음)
   *──────────────────────────*/

  async getEventBySlug(slug: string): Promise<any | null> {
    const records = await (this as any).listCouponEvents({ slug });
    return records[0] ?? null;
  }

  /** 이벤트에 담긴 쿠폰(프로모션) 항목을 sort_order 순으로 반환. */
  async listEventItems(eventId: string): Promise<any[]> {
    return (this as any).listCouponEventItems(
      { event_id: eventId },
      { order: { sort_order: 'ASC' } },
    );
  }

  /** 이벤트의 쿠폰 구성을 통째로 교체(기존 항목 제거 후 순서대로 재생성). */
  async setEventItems(eventId: string, promotionIds: string[]): Promise<void> {
    const existing = await (this as any).listCouponEventItems({ event_id: eventId });
    if (existing.length > 0) {
      await (this as any).deleteCouponEventItems(existing.map((r: any) => r.id));
    }
    if (promotionIds.length > 0) {
      await (this as any).createCouponEventItems(
        promotionIds.map((promotion_id, i) => ({ event_id: eventId, promotion_id, sort_order: i })),
      );
    }
  }

  /*───────────────────────────
   * coupon_grant (발급된 «한 장»)
   *──────────────────────────*/

  /**
   * 유니크 위반인가. 🔴 `e.code === '23505'` 만 보면 안 된다 — `MedusaService` 가 위반을
   * "... already exists" 메시지로 감싸 코드를 잃어버리는 경로가 있다(기존 `recordIssue` 가
   * 같은 이유로 이 판정을 갖고 있었다).
   */
  private isUniqueViolation(e: any): boolean {
    const msg = String(e?.message ?? '').toLowerCase();
    return (
      e?.code === '23505' ||
      msg.includes('unique') ||
      msg.includes('duplicate') ||
      msg.includes('already exists')
    );
  }

  /**
   * 한 장을 발급한다. **같은 `issue_key` 의 재도착은 예외가 아니라 `'duplicate'` 다.**
   *
   * 이것이 따닥·재시도 방어의 전부다. 호출부는 `'duplicate'` 를 「이미 처리됨」으로 다루고,
   * 예약해 둔 claim 슬롯이 있으면 반환해야 한다(슬롯을 잡은 쪽이 반환 책임을 진다).
   */
  async issueGrant(input: {
    promotion_id: string;
    customer_id: string;
    issue_key: string;
    issued_via: IssueTrigger;
    expires_at: Date | null;
    now: Date;
  }): Promise<'created' | 'duplicate'> {
    try {
      await (this as any).createCouponGrants([
        {
          promotion_id: input.promotion_id,
          customer_id: input.customer_id,
          issue_key: input.issue_key,
          issued_via: input.issued_via,
          issued_at: input.now,
          expires_at: input.expires_at,
          used_at: null,
          order_id: null,
        },
      ]);
      return 'created';
    } catch (e: any) {
      if (this.isUniqueViolation(e)) return 'duplicate';
      throw e;
    }
  }

  /**
   * 원시 SQL 을 실행할 EntityManager. 트랜잭션 컨텍스트가 있으면 **그것을 쓴다** — 없으면
   * 저장소의 기본 매니저로 떨어진다(단독 호출 경로).
   */
  private txEm(sharedContext?: Context<EntityManager>): EntityManager {
    return (sharedContext?.transactionManager ?? (this as any).baseRepository_.manager_) as EntityManager;
  }

  /**
   * 슬롯 예약과 장 생성을 **한 트랜잭션에서** 처리한다. 호출부는 결과 하나만 본다.
   *
   * 이전에는 호출부(발급 라우트 4곳)가 `reserveClaimSlot` → `issueGrant` → 실패·중복이면
   * `releaseClaimSlot` 을 손으로 짝지어 밟았다. 그 춤이 넷 다 조금씩 달랐다.
   *
   * 🔴 **장 생성이 슬롯 예약보다 먼저다.** 순서를 뒤집으면 「이미 받은 사람이 소진된 쿠폰에
   * 재시도」가 `'duplicate'` 가 아니라 `'exhausted'` 로 떨어진다 — 옛 라우트 3곳이 정확히
   * 그랬고, 고객에겐 「발급 수량이 모두 소진되었습니다」가, 자동발급 경로에선 실재하지 않는
   * 소진 지표가 나갔다. 중복은 유니크 인덱스가 먼저 판정하게 두고, 슬롯을 못 잡으면
   * `ExhaustedSignal` 로 트랜잭션을 되감아 방금 넣은 장까지 함께 사라지게 한다.
   *
   * - `max_claims === null` — 상한 없음. 카운터를 건드리지 않는다.
   * - `enforce_cap === false` — admin force. 상한을 넘겨서 발급하되 발급 수에는 포함한다
   *   (`issued_count` 가 「지금까지 몇 장 나갔나」의 정본이라 force 도 세야 한다).
   */
  async issueGrantWithSlot(input: IssueGrantWithSlotInput): Promise<'created' | 'duplicate' | 'exhausted'> {
    try {
      return await this.issueGrantWithSlot_(input);
    } catch (e) {
      if (e instanceof DuplicateGrantSignal) return 'duplicate';
      if (e instanceof ExhaustedSignal) return 'exhausted';
      throw e;
    }
  }

  @InjectTransactionManager()
  protected async issueGrantWithSlot_(
    input: IssueGrantWithSlotInput,
    @MedusaContext() sharedContext?: Context<EntityManager>,
  ): Promise<'created' | 'duplicate' | 'exhausted'> {
    // (1) 장 먼저. 같은 `issue_key` 의 재도착은 여기서 유니크 인덱스가 판정한다.
    try {
      // 🔴 `sharedContext` 를 반드시 넘긴다. `MedusaService` 가 만든 메서드는
      // `@InjectManager` 로 감싸여 컨텍스트의 `transactionManager` 를 그대로 이어받는데,
      // 넘기지 않으면 새 매니저를 포크해 **아래 UPDATE 와 다른 트랜잭션**에서 INSERT 한다
      // — 그러면 롤백이 갈려 장만 남고 슬롯은 안 잡힌 상태가 된다.
      await (this as any).createCouponGrants(
        [
          {
            promotion_id: input.promotion_id,
            customer_id: input.customer_id,
            issue_key: input.issue_key,
            issued_via: input.issued_via,
            issued_at: input.now,
            expires_at: input.expires_at,
            used_at: null,
            order_id: null,
          },
        ],
        sharedContext,
      );
      // 🔴 **반드시 여기서 flush 한다.** MikroORM 은 unit-of-work 라 `createCouponGrants` 는
      // 엔티티를 등록만 하고 INSERT 는 커밋 시점까지 미룬다 — 그러면 아래 슬롯 UPDATE(원시
      // SQL 이라 즉시 실행된다)가 «먼저» 나가서, 상한에 닿은 프로모션에 재발급을 시도한
      // 「이미 받은 사람」이 `'duplicate'` 가 아니라 `'exhausted'` 를 받는다. 고치려던 바로
      // 그 순서 문제가 ORM 의 지연 flush 로 되살아난다. 게다가 커밋 시점의 위반은 이 try 를
      // 벗어나 `MikroOrmBaseRepository.transaction` 에서 던져지므로 `'duplicate'` 로 바뀌지도
      // 않는다. (2026-09-03 모듈 통합 스펙이 두 증상을 다 잡아냈다 — 목이었으면 통과했다.)
      await this.txEm(sharedContext).flush();
    } catch (e: any) {
      if (this.isUniqueViolation(e)) throw new DuplicateGrantSignal();
      throw e;
    }

    // (2) 슬롯. 못 잡으면 위 INSERT 까지 함께 되감긴다.
    if (input.max_claims !== null) {
      if (input.enforce_cap) {
        const slot = await this.reserveClaimSlot(input.promotion_id, input.max_claims, sharedContext);
        if (slot === 'exhausted') throw new ExhaustedSignal();
      } else {
        // force: 상한을 집행하지 않되 발급 수에는 포함한다.
        await this.incrementIssuedCount(input.promotion_id, sharedContext);
      }
    }

    return 'created';
  }

  /** 이 고객이 가진 모든 장. 호출부가 프로모션마다 조회하지 않도록 한 번에 가져온다. */
  async listGrantsForCustomer(customerId: string): Promise<CouponGrantRow[]> {
    return (await (this as any).listCouponGrants({ customer_id: customerId })) as CouponGrantRow[];
  }

  /** 이 프로모션이 발급된 모든 장. 발급 현황·회수가 쓴다. */
  async listGrantsForPromotion(promotionId: string): Promise<CouponGrantRow[]> {
    return (await (this as any).listCouponGrants({ promotion_id: promotionId })) as CouponGrantRow[];
  }

  /**
   * 고른 한 장을 소모한다 — **아직 미사용일 때만.** 실제로 소모했으면 `true`.
   *
   * 🔴 술어를 SQL 에 적는 것이 요점이다. 이전 구현은 조건 없는 `updateCouponGrants` 라,
   * 같은 고객이 두 카트를 동시에 완료하면 두 훅이 같은 장을 골라(선택은 결정적이다) 둘 다
   * 덮어썼다 — 한 장으로 할인 주문 두 건, `order_id` 는 나중 것만 남았다. 「1장 = 1회」는
   * 이 PR 이 세우려는 불변식이므로 애플리케이션 읽기-후-쓰기가 아니라 **한 문장**으로
   * 집행한다. 같은 파일의 `reserveClaimSlot` 이 쓰는 기법과 같다 (ADR-0034 결정 1).
   *
   * `deleted_at IS NULL` 도 술어에 넣는다 — 회수된 장은 소모 대상이 아니다.
   */
  async consumeGrantIfUnused(grantId: string, orderId: string, usedAt: Date): Promise<boolean> {
    const rows = await this.txEm().execute(
      `UPDATE "coupon_grant" SET "used_at" = ?, "order_id" = ?
       WHERE "id" = ? AND "used_at" IS NULL AND "deleted_at" IS NULL
       RETURNING "id"`,
      [usedAt, orderId, grantId],
    );
    return (rows?.length ?? 0) > 0;
  }

  /**
   * 백필 전용. `(promotion_id, customer_id, issue_key)` 로 grant 를 찾아 **아직 미사용일 때만**
   * `used_at`/`order_id` 를 채운다.
   *
   * 존재 확인과 "미사용일 때만" 갱신을 한 호출로 묶은 이유: `backfill-coupon-grants.ts` 가
   * grant 생성(`issueGrant`, 멱등)과 사용 상태 이관을 **별개 스텝**으로 부른다 — 스크립트가
   * grant 생성 뒤 이 호출 전에 중단되면(프로세스 킬·DB 타임아웃), 재실행 시 `issueGrant` 는
   * `'duplicate'` 를 돌려주지만 grant 는 이미 존재하므로 이 메서드는 여전히 불려야 한다.
   * `used_at != null` 가드가 그 재실행에서 이미 채워진 값을 또 덮어쓰지 않게 해 멱등하다.
   */
  async markGrantUsedIfUnused(
    promotionId: string,
    customerId: string,
    issueKey: string,
    orderId: string,
    usedAt: Date,
  ): Promise<'consumed' | 'already_used' | 'not_found'> {
    const rows = (await (this as any).listCouponGrants({
      promotion_id: promotionId,
      customer_id: customerId,
      issue_key: issueKey,
    })) as CouponGrantRow[];
    const grant = rows[0];
    if (!grant) return 'not_found';
    if (grant.used_at != null) return 'already_used';
    // 위 조회와 이 갱신 사이에 다른 요청이 같은 장을 소모했을 수 있다. 술어가 SQL 에 있으므로
    // 그 경우 0행이 갱신되고, 여기서 `already_used` 로 정직하게 보고한다 — 조회 결과를 믿고
    // 덮어쓰지 않는다.
    return (await this.consumeGrantIfUnused(grant.id, orderId, usedAt)) ? 'consumed' : 'already_used';
  }

  /**
   * 이 주문에 쓰인 장들을 되돌린다 (A2). 되살린 장수를 돌려준다.
   *
   * **이미 만료된 장은 되살리지 않는다** — 되살려도 못 쓰고, 「돌아왔는데 못 쓴다」가 더 나쁘다.
   * 이미 되돌려진 장은 `used_at` 이 null 이라 대상에서 빠지므로 두 번 불려도 안전하다.
   */
  async restoreGrantsByOrder(orderId: string, now: Date): Promise<number> {
    const rows = (await (this as any).listCouponGrants({ order_id: orderId })) as CouponGrantRow[];
    const targets = rows.filter((g) => {
      if (g.used_at == null) return false;
      if (g.expires_at == null) return true;
      const expiresAt = g.expires_at instanceof Date ? g.expires_at : new Date(g.expires_at);
      return !(now > expiresAt);
    });
    if (targets.length === 0) return 0;
    await (this as any).updateCouponGrants(
      targets.map((g) => ({ id: g.id, used_at: null, order_id: null })),
    );
    return targets.length;
  }

  /**
   * 이 고객의 이 쿠폰 중 **아직 안 쓴 장**을 회수한다.
   *
   * 🔴 이미 쓴 장은 건드리지 않는다. 옛 구현은 전량 soft delete 하고 그 수만큼 슬롯을
   * 되돌렸는데, 그러면 (1) 실제로 소비돼 다시 발급할 수 없는 수량까지 `issued_count` 에서
   * 빠지고, (2) 「누가 언제 썼는가」의 근거가 사라지며(발급 현황의 `used_count` 가 0 이 된다),
   * (3) 그 주문이 나중에 취소돼도 `restoreGrantsByOrder` 가 soft delete 된 행을 못 찾아
   * 조용히 0 을 보고했다.
   *
   * `remaining` 은 회수 후에도 남는 장(= 이미 쓴 장)의 수다. 호출부는 이것으로 표시용 링크를
   * 끊을지 정한다 — 쓴 이력이 남아 있으면 링크를 끊으면 안 된다(마이페이지의 「사용완료」가
   * 링크 행으로 열거된다).
   */
  async revokeGrants(promotionId: string, customerId: string): Promise<{ revoked: number; remaining: number }> {
    const rows = (await (this as any).listCouponGrants({
      promotion_id: promotionId,
      customer_id: customerId,
    })) as CouponGrantRow[];
    const unused = rows.filter((g) => g.used_at == null);
    if (unused.length > 0) {
      await (this as any).softDeleteCouponGrants(unused.map((g) => g.id));
    }
    return { revoked: unused.length, remaining: rows.length - unused.length };
  }
}

export default PromotionMetaModuleService;
