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
    },
  )
  .indexes([
    // 주의: 실제 DB 인덱스는 마이그레이션에서 PARTIAL(`WHERE deleted_at IS NULL`)로 생성된다.
    // DML DSL 이 partial 조건을 표현하지 못해 여기선 full 로만 선언된다.
    // 회수(soft delete) 후 재발급이 이 partial 조건에 의존한다 — 스키마를 재생성할 때
    // `WHERE deleted_at IS NULL` 을 반드시 보존할 것(full unique 로 바뀌면 재발급이 깨진다).
    { on: ['customer_id'], name: 'idx_coupon_grant_customer' },
    { on: ['promotion_id'], name: 'idx_coupon_grant_promotion' },
    { on: ['promotion_id', 'customer_id', 'issue_key'], name: 'idx_coupon_grant_issue_key', unique: true },
  ]);

export default CouponGrant;
