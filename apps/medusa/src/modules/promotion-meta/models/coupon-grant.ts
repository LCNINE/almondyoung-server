import { model } from '@medusajs/framework/utils';

/**
 * 발급된 «한 장». 발급 1건 = 1행이다.
 *
 * 이 모델이 생기기 전에는 customer↔promotion 링크 행이 그 역할을 했는데, 그 테이블은
 * `(customer_id, promotion_id)` 복합 PK 라 **고객당 한 장**만 가능했다. 같은 쿠폰을 여러
 * 출처에서 여러 번 발급하려면 그 제약을 풀어야 하고, 그래서 우리 테이블로 나왔다.
 *
 * 🔴 그 복합 PK 는 동시에 **따닥 방어**이기도 했다 — `Link.create` 가 upsert 라 두 번째
 * 요청이 첫 행을 덮어썼다. 방어가 아니라 부작용이었다. 여기서는 `issue_key` + 파셜 유니크가
 * 그 일을 의도적으로 한다. 유니크를 지우면 발급 버튼 따닥이 곧 공짜 쿠폰이 된다.
 */
const CouponGrant = model
  .define(
    { name: 'CouponGrant', tableName: 'coupon_grant' },
    {
      id: model.id().primaryKey(),
      promotion_id: model.text(),
      customer_id: model.text(),
      /** 이 발급이 어떤 «사건»인가. 같은 사건은 몇 번 도착해도 한 장이다. */
      issue_key: model.text(),
      /** `IssueTrigger` 어휘 5개. 새 값 없음. */
      issued_via: model.text(),
      issued_at: model.dateTime(),
      /** 이 한 장의 만료. 발급 시점에 `computeExpiresAt` 로 계산해 박는다. null = 무기한. */
      expires_at: model.dateTime().nullable(),
      used_at: model.dateTime().nullable(),
      order_id: model.text().nullable(),
      /** 어드민이 이 장을 회수한 시각. 사용된 장은 soft delete 되지 않으므로 이 열이 회수의 유일한 표지다. */
      revoked_at: model.dateTime().nullable(),
    },
  )
  .indexes([
    // 여기 선언도 **파셜이다** — DML 이 `WHERE deleted_at IS NULL` 을 자동으로 붙인다
    // (`@medusajs/utils/dist/dml/helpers/entity-builder/build-indexes.js` 의
    // `transformIndexWhere`: where 가 없으면 `"deleted_at IS NULL"` 을 박고, 있으면
    // `AND deleted_at IS NULL` 을 덧댄다 — 모든 DML 인덱스가 예외 없이 그렇다).
    //
    // 그래서 마이그레이션의 파셜 유니크와 여기 선언은 **같은 인덱스**이고, 회수(soft delete)
    // 후 재발급은 모듈 러너에서 실제로 검증된다
    // (`__tests__/service.integration.spec.ts` — 「회수(soft delete) 후 같은 issue_key 로
    // 재발급된다 — 파셜 유니크」). 옛 주석은 「DML 이 partial 을 표현 못 해 여기선 full」이라고
    // 적어 두 선언이 갈린 것처럼 읽혔는데, 사실이 아니었다(2026-09-02 전체 리뷰).
    //
    // 여전히 지킬 것: 스키마를 손으로 재생성할 때 `WHERE deleted_at IS NULL` 을 빠뜨리면
    // full unique 가 되어 재발급이 깨진다.
    //
    // ⚠️ CHECK 제약(`issued_via` 어휘)은 사정이 다르다 — 모델에 `.checks()` 가 없으므로
    // 모듈 러너가 만드는 스키마엔 그 제약이 **없고**, 마이그레이션에만 있다. 즉 어휘를
    // 벗어난 값은 통합 스펙에서 안 걸린다.
    { on: ['customer_id'], name: 'idx_coupon_grant_customer' },
    { on: ['promotion_id'], name: 'idx_coupon_grant_promotion' },
    // `restoreGrantsByOrder` 가 `order.canceled` 마다 이 컬럼으로 조회한다. 테이블은 발급
    // 1건당 1행으로 자란다 — 인덱스 없이는 취소마다 풀스캔이다.
    { on: ['order_id'], name: 'idx_coupon_grant_order' },
    { on: ['promotion_id', 'customer_id', 'issue_key'], name: 'idx_coupon_grant_issue_key', unique: true },
  ]);

export default CouponGrant;
