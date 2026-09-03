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
  revoked_at: Date | string | null;
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

/** `revokeGrants_` 의 두 얼굴 — 어드민 회수(전부, 표지 찍음)와 워크플로 보상(키 목록, 표지 없음). */
type RevokeGrantsOptions = {
  /** 주면 이 `issue_key` 들만 대상이다. 보상이 «이번 실행이 만든 것»으로 좁힐 때 쓴다. */
  issueKeys?: string[];
  /** `revoked_at` 을 찍는가. 어드민 회수는 true, 보상은 false. */
  markRevoked: boolean;
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
   * 이 프로모션이 지금까지 소진한 슬롯 수.
   *
   * 「슬롯을 점유한다」의 정의는 **`deleted_at IS NULL`** 이다 — 회수된 미사용 장은 soft
   * delete 되어 슬롯을 돌려주고, 사용된 장은 회수돼도 남아 슬롯을 계속 점유한다(이미 소비돼
   * 다시 발급할 수 없다). 옛 `reserveClaimSlot`/`releaseClaimSlot` 짝이 손으로 지키던 규칙을
   * 데이터가 스스로 표현하게 한 것이다.
   *
   * 🔴 `count(*)` 는 bigint 라 드라이버가 **문자열**로 돌려준다. `::int` 와 `Number()` 를 둘 다
   * 건다 — 한쪽이라도 빠지면 비교가 조용히 어긋난다.
   */
  async countIssuedGrants(promotionId: string, sharedContext?: Context<EntityManager>): Promise<number> {
    const rows = await this.txEm(sharedContext).execute(
      `SELECT count(*)::int AS c FROM "coupon_grant"
        WHERE "promotion_id" = ? AND "deleted_at" IS NULL`,
      [promotionId],
    );
    return Number(rows?.[0]?.c ?? 0);
  }

  /**
   * 프로모션별 발급 장수를 한 번에 센다. 목록 화면이 프로모션마다 조회하지 않도록.
   * 장이 없는 프로모션도 **0 으로 채워서** 돌려준다 — 호출부가 `undefined` 를 만나
   * `?? null` 로 접으면 「무제한」과 「0장」이 구분되지 않는다.
   *
   * `sharedContext` 는 형제 `countIssuedGrants` 와 같은 이유로 받는다 — 넘기면 그 트랜잭션
   * 안을 읽고, 안 넘기면 저장소 기본 매니저로 떨어진다. 옛 구현은 이 인자를 거부하고 주석으로
   * 「집행 경로에서 부르지 말 것」만 적어 두었는데, 주석은 덫을 표시할 뿐 막지 못한다.
   */
  async countIssuedGrantsByPromotion(
    promotionIds: string[],
    sharedContext?: Context<EntityManager>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>(promotionIds.map((id) => [id, 0]));
    if (promotionIds.length === 0) return result;
    const rows = await this.txEm(sharedContext).execute(
      `SELECT "promotion_id", count(*)::int AS c FROM "coupon_grant"
        WHERE "deleted_at" IS NULL AND "promotion_id" IN (?)
        GROUP BY "promotion_id"`,
      [promotionIds],
    );
    for (const row of rows ?? []) {
      result.set(String(row.promotion_id), Number(row.c));
    }
    return result;
  }

  /**
   * 이 프로모션의 발급을 직렬화한다. **상한을 집행하는 트랜잭션에서만** 부른다.
   *
   * 🔴 이 락이 상한의 원자성을 준다. 옛 `UPDATE ... WHERE issued_count < ?` 도 원자성의
   * 출처는 카운터 «값» 이 아니라 이 행의 배타 락이었다 — Postgres READ COMMITTED 에서
   * 두 번째 UPDATE 는 첫 커밋을 기다렸다가 WHERE 를 재평가한다. 같은 행을 `FOR UPDATE` 로
   * 잠그고 장을 세면 동일한 직렬화를 얻는다.
   *
   * 🔴 **fail-closed.** 0행이면(그 `promotion_id` 의 `promotion_meta` 가 없으면) throw 해
   * 트랜잭션을 되감는다 — 잠그지 못했는데 조용히 넘어가면 아래 COUNT 검사가 직렬화 없이
   * 돌아 상한이 새는 fail-open 이 된다(옛 `reserveClaimSlot` 은 0행 갱신 시 `'exhausted'`
   * 를 돌려줘 fail-closed 였다). 오늘은 호출부가 전부 메타 레코드에서 `max_claims` 를 뽑아
   * 넘기므로(`enforcing===true` 면 그 레코드가 존재) 이 분기에 실제로 닿지 않지만, 그
   * 불변식을 지키는 것은 이 함수가 아니라 호출 사슬이다 — 조용히 안 잠그는 것보다 시끄럽게
   * 500 으로 죽는 편이 낫다.
   */
  private async lockPromotionForIssue(
    promotionId: string,
    sharedContext?: Context<EntityManager>,
  ): Promise<void> {
    const rows = await this.txEm(sharedContext).execute(
      `SELECT 1 FROM "promotion_meta" WHERE "promotion_id" = ? FOR UPDATE`,
      [promotionId],
    );
    if ((rows?.length ?? 0) === 0) {
      throw new Error(`Cannot lock promotion_meta for issue — no row for promotion_id=${promotionId}`);
    }
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
   * - `max_claims === null` — 상한 없음. 잠그지도 세지도 않는다.
   * - `enforce_cap === false` — admin force. 상한을 넘겨서 발급하되 발급 수에는 포함한다
   *   (장 자체가 카운트라 — `coupon_grant` 가 「지금까지 몇 장 나갔나」의 정본이므로 force 로
   *   만든 장도 이미 세어진 상태다. 별도로 셀 것이 없다). 🔴 force 는 `lockPromotionForIssue`
   *   를 안 타므로, 그와 동시에 상한을 «집행하는» 발급이 진행 중이면 그 발급의 COUNT 가
   *   방금 들어온 force INSERT 를 못 보고 통과시킬 수 있다 — force 는 정의상 상한을 넘기는
   *   것이라 스펙 위반은 아니지만, 결과 프로모션이 순간적으로 cap+1 장이 될 수 있다는
   *   뜻이다(「집행할 때만 잠근다」 최적화의 명시되지 않은 귀결).
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
    // (0) 상한을 집행할 때만 잠근다. 이 락이 아래 COUNT 를 정확하게 만든다.
    const enforcing = input.max_claims !== null && input.enforce_cap;
    if (enforcing) {
      await this.lockPromotionForIssue(input.promotion_id, sharedContext);
    }

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
      // 엔티티를 등록만 하고 INSERT 는 커밋 시점까지 미룬다 — flush 없이 아래 (2) 의 COUNT(원시
      // SQL 이라 즉시 실행된다)를 돌리면 방금 등록한 장이 아직 DB 에 없어 세어지지 않는다.
      // COUNT 가 실제보다 1 작게 나오므로 `issued > max_claims` 검사가 매번 통과해 버려 —
      // 상한이 발급마다 1 씩 새는 fail-open 이 된다(트랜잭션이 커밋되고 나서야 진짜 개수가
      // 드러난다). 게다가 커밋 시점의 위반은 이 try 를 벗어나
      // `MikroOrmBaseRepository.transaction` 에서 던져지므로 `'duplicate'` 로 바뀌지도
      // 않는다. (2026-09-03 모듈 통합 스펙이 두 증상을 다 잡아냈다 — 목이었으면 통과했다.)
      await this.txEm(sharedContext).flush();
    } catch (e: any) {
      if (this.isUniqueViolation(e)) throw new DuplicateGrantSignal();
      throw e;
    }

    // (2) 상한. INSERT 뒤에 세므로 방금 넣은 장이 포함된다 — 넘으면 트랜잭션째 되감긴다.
    //     force(`enforce_cap=false`)는 세기만 하고 막지 않으므로 아무것도 하지 않는다
    //     (장 자체가 카운트라 옛 `incrementIssuedCount` 가 필요 없다).
    if (enforcing) {
      const issued = await this.countIssuedGrants(input.promotion_id, sharedContext);
      if (issued > Number(input.max_claims)) throw new ExhaustedSignal();
    }

    // (3) 옛 카운터 미러 — 상한의 정본은 위 COUNT 지만, 컬럼이 살아 있는 동안 옛 태스크가
    //     그걸로 집행하므로 같은 트랜잭션에서 따라가게 한다(`mirrorIssuedCount` 주석).
    if (input.max_claims !== null) {
      await this.mirrorIssuedCount(input.promotion_id, 1, sharedContext);
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
   * 집행한다. 같은 파일의 `countIssuedGrants`/`lockPromotionForIssue` 가 쓰는 기법과 같다
   * (ADR-0034 결정 1).
   *
   * `deleted_at IS NULL` 도 술어에 넣는다 — 회수된 장은 소모 대상이 아니다.
   *
   * `sharedContext` 는 형제 원시 SQL 헬퍼(`countIssuedGrants` 등)와 같은 이유로 열어 둔다 —
   * 넘기지 않으면 저장소의 기본 매니저로 떨어져 호출자의 트랜잭션 **밖**에서 갱신된다.
   * 소모를 주문 쓰기와 한 트랜잭션에 묶는 호출자가 생기면, 그 트랜잭션이 롤백돼도 장은
   * 사용됨으로 남고 `order_id` 가 대롱대롱 남는다.
   */
  async consumeGrantIfUnused(
    grantId: string,
    orderId: string,
    usedAt: Date,
    sharedContext?: Context<EntityManager>,
  ): Promise<boolean> {
    const rows = await this.txEm(sharedContext).execute(
      `UPDATE "coupon_grant" SET "used_at" = ?, "order_id" = ?, "updated_at" = now()
       WHERE "id" = ? AND "used_at" IS NULL AND "deleted_at" IS NULL
       RETURNING "id"`,
      [usedAt, orderId, grantId],
    );
    return (rows?.length ?? 0) > 0;
  }

  /**
   * 「이 주문에 쓸 장 한 장」을 **고르고 소모한다 — 한 문장으로.** 소모한 장의 id, 없으면 `null`.
   *
   * 옛 구조는 훅이 `selectGrantToConsume`(FEFO) 으로 장을 고른 뒤 `consumeGrantIfUnused(id)` 로
   * 찍었다. 고르기와 CAS 가 다른 층에 있어, 같은 고객의 두 카트가 동시에 완료되면 둘이
   * «결정적으로 같은 장»을 골라 한쪽만 이기고 진 쪽은 다음 장을 시도하지 않았다 — 한 장으로
   * 할인 주문 두 건(PR #778 재리뷰 F1). 선택을 SQL 로 내리면 그 창 자체가 없다:
   *
   * - **FEFO** 는 `ORDER BY expires_at NULLS LAST, issued_at, id` — `grants.ts` 의 옛 정렬과 같다.
   * - **만료 경계(포함)** 는 `expires_at >= now` — `usableGrants` 와 같은 경계여야 카트 게이트와
   *   어긋나지 않는다.
   * - **재호출 멱등성**은 `NOT EXISTS(같은 order_id)` — 엔진이 이 훅을 두 번 불러도 주문당
   *   쿠폰당 한 장이다.
   * - **동시성**은 `FOR UPDATE SKIP LOCKED` — 다른 트랜잭션이 잡은 장은 건너뛰고 다음 장을 잡는다.
   *   장이 하나뿐이면 늦은 쪽은 `null` 이고, 그게 정답이다.
   *
   * `null` 은 「소모할 장이 없다」다 — 발급 개념이 없는 `public` 쿠폰이 대부분이므로 호출부는
   * 경고하지 않는다. `consumeGrantIfUnused(id)` 는 id 로 찍는 원시 연산으로 남는다(백필·스펙
   * 픽스처). **핫패스(주문 생성 훅)는 이 메서드만 부른다.**
   */
  async consumeOneUsableGrant(
    input: { promotion_id: string; customer_id: string; order_id: string; now: Date },
    sharedContext?: Context<EntityManager>,
  ): Promise<string | null> {
    const rows = await this.txEm(sharedContext).execute(
      `UPDATE "coupon_grant" SET "used_at" = ?, "order_id" = ?, "updated_at" = now()
        WHERE "id" = (
          SELECT "id" FROM "coupon_grant"
           WHERE "promotion_id" = ? AND "customer_id" = ?
             AND "deleted_at" IS NULL AND "used_at" IS NULL
             AND ("expires_at" IS NULL OR "expires_at" >= ?)
             AND NOT EXISTS (
               SELECT 1 FROM "coupon_grant" o
                WHERE o."promotion_id" = ? AND o."customer_id" = ?
                  AND o."order_id" = ? AND o."deleted_at" IS NULL)
           ORDER BY "expires_at" ASC NULLS LAST, "issued_at" ASC, "id" ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING "id"`,
      [
        input.now,
        input.order_id,
        input.promotion_id,
        input.customer_id,
        input.now,
        input.promotion_id,
        input.customer_id,
        input.order_id,
      ],
    );
    const id = rows?.[0]?.id;
    return id != null ? String(id) : null;
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
   * **회수된 장도 되살리지 않는다** — 어드민이 명시적으로 뺏은 쿠폰이 주문 취소로 돌아오면
   * 안 된다(설계 결정 3, `revoked_at`).
   * 이미 되돌려진 장은 `used_at` 이 null 이라 대상에서 빠지므로 두 번 불려도 안전하다.
   */
  async restoreGrantsByOrder(orderId: string, now: Date): Promise<number> {
    const rows = (await (this as any).listCouponGrants({ order_id: orderId })) as CouponGrantRow[];
    const targets = rows.filter((g) => {
      if (g.used_at == null) return false;
      // 🔴 회수된 장은 되살리지 않는다. 어드민이 명시적으로 뺏은 쿠폰이 주문 취소로 돌아오면 안 된다.
      if (g.revoked_at != null) return false;
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
   * 워크플로 보상 전용. **이번 실행이 만든 장만** 지목해 되돌린다.
   *
   * `revokeGrants` 와 달리 「이 고객의 이 쿠폰 전부」가 아니라 `issue_key` 목록으로 좁힌다 —
   * 보상은 자기가 만든 것만 치워야 하고, 같은 쌍에 미리 있던 장(다른 제출로 발급됐거나
   * 이번 실행에서 `'duplicate'` 로 판정된 장)은 남의 것이다. 그중에서도 **아직 안 쓴 장만**
   * 지운다 — 실제로 치운 장수를 돌려준다.
   */
  async revokeGrantsByIssueKeys(
    promotionId: string,
    customerId: string,
    issueKeys: string[],
  ): Promise<number> {
    if (issueKeys.length === 0) return 0;
    // 🔴 `revokeGrants` 와 **같은 본체**를 지난다. 둘이 따로 구현돼 있을 때 「쓴 장은 soft
    // delete 하지 않는다」가 어드민 회수에만 걸려 있었다 — 스텝과 보상 사이에 소비된 장을
    // 보상이 지우면 실제로 소비된 슬롯이 COUNT 에서 빠지고 주문 취소 복원 대상에서도 사라졌다
    // (PR #778 리뷰 F12). 다른 것은 회수 표지뿐이다: 보상은 어드민의 결정이 아니므로
    // `revoked_at` 을 찍지 않는다(찍으면 그 주문이 취소돼도 되살아나지 않게 된다).
    const { revoked } = await this.revokeGrants_(promotionId, customerId, {
      issueKeys,
      markRevoked: false,
    });
    return revoked;
  }

  /**
   * 이 고객의 이 쿠폰을 회수한다. 매칭된 **전부**에 `revoked_at` 을 찍고, 그중 **아직 안 쓴
   * 장만** soft delete 한다.
   *
   * 🔴 이미 쓴 장은 soft delete 하지 않는다. 옛 구현은 전량 soft delete 하고 그 수만큼
   * 슬롯을 되돌렸는데, 그러면 (1) 실제로 소비돼 다시 발급할 수 없는 수량까지 `issued_count`
   * 에서 빠지고, (2) 「누가 언제 썼는가」의 근거가 사라졌다(발급 현황의 `used_count` 가 0 이
   * 된다). `deleted_at` 은 「슬롯을 안 점유한다」는 뜻이라 이미 쓴 장에는 못 쓰지만, 회수
   * 사실 자체는 잊으면 안 된다 — 그래서 `revoked_at` 을 이미 쓴 장에도 찍는다. 이게 없으면
   * 그 주문이 나중에 취소될 때 `restoreGrantsByOrder` 가 「쓴 적 있는 장」으로만 판단해
   * 어드민이 뺏은 쿠폰을 되살려 버린다(설계 결정 3) — soft delete 와 회수 표지는 별개의
   * 질문에 답한다: 하나는 「슬롯을 세는가」, 다른 하나는 「회수됐는가」.
   *
   * `remaining` 은 회수 후에도 남는 장(= 이미 쓴 장)의 수다. Task 7 이전엔 호출부(두 DELETE
   * 라우트)가 이것으로 표시용 링크를 끊을지 정했다 — 링크 자체가 사라진 지금 그 용도는
   * 없어졌고, `revoked`(이번에 실제로 회수된 수)와 구분되는 값으로만 남는다.
   */
  async revokeGrants(promotionId: string, customerId: string): Promise<{ revoked: number; remaining: number }> {
    return this.revokeGrants_(promotionId, customerId, { markRevoked: true });
  }

  /**
   * `revokeGrants` 의 트랜잭션 본체. `issueGrantWithSlot_` 과 같은 모양이다 —
   * `@InjectTransactionManager` 가 트랜잭션을 열고, 아래 두 쓰기(회수 표지 스탬프 + 미사용분
   * soft delete)가 같은 `sharedContext` 를 받아 그 안에서 실행된다.
   *
   * 🔴 옛 구현은 두 쓰기가 `MedusaService` 가 생성한 메서드를 각각 직접 불러 **자기
   * 트랜잭션**을 하나씩 열었다 — 첫 UPDATE 커밋 후 두 번째(soft delete) 전에 죽으면
   * 「회수 표시는 됐는데 여전히 쓸 수 있고 슬롯도 점유하는」 장이 남았다. `sharedContext` 를
   * 명시적으로 넘기지 않으면 생성된 메서드는 새 매니저를 포크해 컨텍스트를 안 이어받는다 —
   * `issueGrantWithSlot_` 의 `createCouponGrants` 주석과 같은 함정이다.
   */
  @InjectTransactionManager()
  protected async revokeGrants_(
    promotionId: string,
    customerId: string,
    opts: RevokeGrantsOptions,
    @MedusaContext() sharedContext?: Context<EntityManager>,
  ): Promise<{ revoked: number; remaining: number }> {
    const filter: Record<string, unknown> = { promotion_id: promotionId, customer_id: customerId };
    if (opts.issueKeys) filter.issue_key = { $in: opts.issueKeys };
    const rows = (await (this as any).listCouponGrants(filter, {}, sharedContext)) as CouponGrantRow[];
    if (rows.length === 0) return { revoked: 0, remaining: 0 };

    if (opts.markRevoked) {
      // 🔴 사용 여부와 무관하게 회수 표지를 찍는다. 사용된 장은 아래 soft delete 대상이 아니라
      //    살아남는데, 그 장을 주문 취소가 되살리는 것을 이 열이 막는다.
      //    이미 찍힌 장은 건너뛴다 — 재회수가 처음 회수한 시각을 덮어쓰면 「언제 뺏었나」가 사라진다.
      const unmarked = rows.filter((g) => g.revoked_at == null);
      if (unmarked.length > 0) {
        const now = new Date();
        await (this as any).updateCouponGrants(
          unmarked.map((g) => ({ id: g.id, revoked_at: now })),
          sharedContext,
        );
      }
    }

    const unused = rows.filter((g) => g.used_at == null);
    if (unused.length > 0) {
      await (this as any).softDeleteCouponGrants(unused.map((g) => g.id), {}, sharedContext);
      // soft delete 가 곧 슬롯 반환이다 — 옛 카운터도 같은 트랜잭션에서 따라간다.
      await this.mirrorIssuedCount(promotionId, -unused.length, sharedContext);
    }
    return { revoked: unused.length, remaining: rows.length - unused.length };
  }

  /**
   * 옛 `issued_count` 컬럼을 «따라가게» 한다 — expand 단계의 dual write.
   *
   * 상한의 정본은 `coupon_grant` COUNT 다(설계 결정 1). 그런데 컬럼은 후속 contract PR 이
   * 지울 때까지 남고, 그동안 롤링 중인 옛 태스크와 롤백된 배포는 **이 컬럼으로** 상한을
   * 집행한다(`UPDATE … WHERE issued_count < max_claims`). 쓰기를 멈춘 채 두면 카운터가 실제
   * 장수 아래로 동결돼, 롤백 즉시 상한을 넘겨 발급하는 fail-open 이 된다(PR #778 리뷰 F5).
   * 그래서 장을 만들고 지우는 그 트랜잭션에서 같은 델타를 컬럼에도 적는다.
   *
   * 의미는 옛 코드와 같게 둔다 — **상한 있는 프로모션만** 센다(`max_claims IS NOT NULL`).
   * 옛 `reserveClaimSlot`/`incrementIssuedCount` 가 그랬고, 무제한 프로모션까지 세면 발급마다
   * `promotion_meta` 행 락을 잡아 「상한 없으면 잠그지도 세지도 않는다」는 최적화를 버리게 된다.
   * 롤백 안전에 필요한 것은 상한 집행이 맞는 것이지 표시가 맞는 것이 아니다.
   *
   * 이 미러는 contract PR 이 컬럼과 함께 지운다. 그때까지 카운터와 COUNT 가 어긋나면
   * (예: 컬럼 쓰기가 없던 창에서 발급된 장) PR 본문의 정합화 SQL 한 방이 맞춘다.
   */
  private async mirrorIssuedCount(
    promotionId: string,
    delta: number,
    sharedContext?: Context<EntityManager>,
  ): Promise<void> {
    await this.txEm(sharedContext).execute(
      `UPDATE "promotion_meta"
          SET "issued_count" = GREATEST("issued_count" + ?, 0), "updated_at" = now()
        WHERE "promotion_id" = ? AND "max_claims" IS NOT NULL AND "deleted_at" IS NULL`,
      [delta, promotionId],
    );
  }
}

export default PromotionMetaModuleService;
