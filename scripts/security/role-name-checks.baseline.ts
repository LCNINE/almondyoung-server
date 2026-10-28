/**
 * 역할 이름 문자열의 파일별 기준 개수(래칫). `role-name-checks.spec.ts` 가 실제 개수와 같기를 요구한다 —
 * 늘면 새 역할 이름 판정이 생긴 것이고, 줄었으면 여기 숫자를 같이 줄인다(옛 판정을 걷어 낼수록 0 에 가까워진다).
 */
export type RoleLiteralKind =
  /** 옛 라우트 가드(역할 가드·스코프 이름). 라우트 그림자 판정이 권한 선언과 비교한다. */
  | 'legacy-route-guard'
  /** 판정 지점의 옛 식. 결과는 옛 식이 정하고 권한 판정과 비교한다. */
  | 'legacy-checkpoint'
  /** 옛 인가 라이브러리. */
  | 'legacy-library'
  /** 역할 → 권한·스코프 정의와 첫 등록 부여. 판정이 아니라 매핑이다. */
  | 'role-mapping'
  /** 시스템 역할 규칙(최소 1명·편집 불가) — 역할 이름을 아는 유일한 판정 자리. */
  | 'system-role-rule'
  /** 시스템 행위자·서비스 위임 토큰의 옛 표기. 판정 지점은 시스템 주체로 본다. */
  | 'system-identity'
  /** 역할 이름과 우연히 같은 데이터 값·경로·문서 예시. 판정이 아니다. */
  | 'data-value';

export const ROLE_LITERAL_BASELINE: Readonly<Record<string, { count: number; kind: RoleLiteralKind }>> = {
  // 관리자 화면: 역할 필터 옵션·표시 정렬·상품 출처(master/version)·리뷰 출처·URL 세그먼트 — 판정은 없다.
  'apps/admin-web/src/app/api/proxy/medusa/[...path]/route.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/app/api/proxy/ugc/[...path]/route.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/components/table/table-cells/user/role-cell.tsx': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/features/cs/review/lib/review-tabs.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/products-detail/components/draft-completion-checklist/draft-completion-checklist-model.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/products-detail/components/general/basic-information-model.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/products-detail/components/images/product-images-model.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/products-detail/components/options/product-options-model.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/products-detail/components/variants/product-variants-model.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/products-detail/components/version-lifecycle-actions/version-lifecycle-actions-model.ts': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/mall/shop-listings/template/index.tsx': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/order/history/components/modals/cancel-order-modal.tsx': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/features/users/components/filter-box/index.tsx': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/hooks/table/columns/use-variants-matching-table-columns.tsx': { count: 1, kind: 'data-value' },
  'apps/admin-web/src/hooks/table/filters/use-customer-table-filters.ts': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/hooks/table/filters/use-user-table-filters.ts': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/lib/services/products/query-keys.ts': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/lib/services/products/use-product-detail.ts': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/lib/types/dto/products.ts': { count: 2, kind: 'data-value' },
  'apps/admin-web/src/lib/types/dto/review.ts': { count: 1, kind: 'data-value' },
  'apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts': {
    count: 1,
    kind: 'data-value',
  },
  'apps/core/src/modules/sales-order/controllers/admin-return-exchange.controller.ts': { count: 1, kind: 'data-value' },
  // 환불 행위자 «종류» 표기(actor: 'customer' | 'admin' | 'system') — 판정이 아니다
  'apps/core/src/modules/sales-order/cancellation-refund/cancellation-refund.manager.ts': { count: 6, kind: 'data-value' },
  // 반품 수령(collected) 이벤트 계약의 requestedBy 값('admin') — 판정이 아니다(K8 PR6)
  'apps/core/src/modules/sales-order/customer-return/customer-return-receiving.manager.ts': { count: 1, kind: 'data-value' },
  // 반품 완료 이벤트 계약의 requestedBy 값('admin') — 판정이 아니다(K8 PR6)
  'apps/core/src/modules/sales-order/customer-return/customer-return-settlement.manager.ts': { count: 1, kind: 'data-value' },
  // 반품 접수 이벤트 계약의 requestedBy 값('admin') — 판정이 아니다(K8 PR5)
  'apps/core/src/modules/sales-order/customer-return/customer-return.manager.ts': { count: 1, kind: 'data-value' },
  'apps/core/src/modules/sales-order/dto/cancel-sales-order.dto.ts': { count: 1, kind: 'data-value' },
  // 취소 기록의 cancelledBy 값('admin') — 판정이 아니다(K7 PR4 가 관리자 문에서 옮겨 왔다)
  'apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts': { count: 1, kind: 'data-value' },
  'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts': { count: 2, kind: 'data-value' },
  'apps/file-service/src/access/service-delegation.ts': { count: 1, kind: 'system-identity' },
  'apps/membership/src/config/swagger.config.ts': { count: 1, kind: 'data-value' },
  'apps/membership/src/controllers/admin-operations.controller.ts': { count: 2, kind: 'data-value' },
  'apps/notification/src/dispatcher/handlers/order-event.consumer.ts': { count: 1, kind: 'data-value' },
  'apps/notification/src/provider/dto/update-provider.dto.ts': { count: 1, kind: 'data-value' },
  'apps/notification/src/template/dto/create-template.dto.ts': { count: 1, kind: 'data-value' },
  'apps/ugc-service/src/review-permissions/review-permission.service.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/review-permissions/types.ts': { count: 1, kind: 'data-value' },
  'apps/ugc-service/src/reviews/dto/admin-review-response.dto.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/reviews/dto/review-list-query.dto.ts': { count: 3, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/dto/shop-listing-response.dto.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.ts': { count: 1, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/shop-listing.constants.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/shop-listing.manager.ts': { count: 1, kind: 'data-value' },
  // 휴면 처리 대상에서 고객 역할 보유자를 고르는 조회 조건 — 판정이 아니라 대상 선별
  'apps/user-service/src/api/admin/dormant/dormant.service.ts': { count: 1, kind: 'data-value' },
  // 역할 이름 필터 파라미터 설명의 예시 문자열
  'apps/user-service/src/api/admin/users/dto/get-users-query.dto.ts': { count: 1, kind: 'data-value' },
  // 가입 시 고객 역할을 붙이기 위한 역할 조회
  'apps/user-service/src/api/auth/auth.service.ts': { count: 1, kind: 'data-value' },
  // 고객 역할 이름 목록(직원 = 고객이 아닌 역할)과 시스템 역할 이름 — 최소 1명·편집 불가 규칙의 입력
  'apps/user-service/src/api/iam/iam.constants.ts': { count: 3, kind: 'system-role-rule' },
  // 신규 계정에 기본 고객 역할을 붙이기 위한 역할 조회
  'apps/user-service/src/api/users/users.service.ts': { count: 1, kind: 'data-value' },
  'apps/wallet/src/admin/refund-admin.controller.ts': { count: 1, kind: 'data-value' },
  'apps/wallet/src/admin/refund-requests-admin.controller.ts': { count: 2, kind: 'data-value' },
  'libs/authorization/src/permissions/permission-catalog.ts': { count: 18, kind: 'role-mapping' },
  'libs/authorization/src/permissions/permission.types.ts': { count: 4, kind: 'role-mapping' },
};
