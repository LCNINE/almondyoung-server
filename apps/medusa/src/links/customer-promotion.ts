import { defineLink } from '@medusajs/framework/utils';
import CustomerModule from '@medusajs/medusa/customer';
import PromotionModule from '@medusajs/medusa/promotion';

// isList: true on both sides = many-to-many
// 한 쿠폰을 여러 고객에게 발급하고, 한 고객이 여러 쿠폰을 가질 수 있음
//
// `extraColumns` 로 발급된 «한 장»의 상태를 링크 행에 싣는다 (#488 N4 → 7-1 · 7-7 · A2).
// 그전까지 인스턴스가 못 하던 일을 클래스(`promotion_meta.issued_count`)와
// 사이드테이블(`promotion_issue_log`)이 나눠 하고 있었다.
//
// ⚠️ `issued_count` 는 옮기지 않는다 — 원자적 예약이 목적이라 링크를 COUNT 하는 순간
//    원자성을 잃는다. #488 본문 7-1 의 「링크 수에서 도출」 제안은 따르지 않는다.
//
// ⚠️ 이 스키마 변경에는 **마이그레이션 파일이 없다.** 컨테이너 CMD 의
//    `medusa db:migrate --execute-safe-links` 가 적용한다 — `--execute-safe` 는 SQL 에
//    `alter column`/`drop column` 이 있는 변경만 건너뛰고, nullable 컬럼 «추가»는
//    `add column` 이라 안전 목록에 든다
//    (`@medusajs/link-modules/dist/migration/index.js:40,254-258`).
export default defineLink(
  { linkable: CustomerModule.linkable.customer, isList: true },
  { linkable: PromotionModule.linkable.promotion, isList: true },
  {
    database: {
      extraColumns: {
        /** 이 «한 장»의 만료 시각. 발급 시점에 계산해 박는다. null = 무기한. */
        expires_at: { type: 'datetime', nullable: true },
        /** 이 «한 장»이 주문에 쓰인 시각. */
        used_at: { type: 'datetime', nullable: true },
        /** 이 «한 장»이 쓰인 주문. A2(취소·환불 시 복구)가 여기서 시작한다. */
        order_id: { type: 'string', nullable: true },
        /** 발급 경로. `IssueTrigger` 어휘(`promotion_issue_log.trigger` 와 같은 어휘). */
        issued_via: { type: 'string', nullable: true },
      },
    },
  },
);
