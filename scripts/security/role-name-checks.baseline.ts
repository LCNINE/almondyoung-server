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
  'apps/ai/src/platform/auth/ai-scopes.ts': { count: 2, kind: 'role-mapping' },
  'apps/core/src/modules/archive/archive.controller.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/core/src/modules/catalog/core/notices/notices.controller.ts': { count: 8, kind: 'legacy-route-guard' },
  'apps/core/src/modules/catalog/core/site-popups/site-popups.controller.ts': { count: 12, kind: 'legacy-route-guard' },
  'apps/core/src/modules/catalog/operations/bulk-session/bulk-session.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/core/src/modules/catalog/operations/bulk-session/form-export.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts': {
    count: 1,
    kind: 'system-identity',
  },
  'apps/core/src/modules/customer-service/controllers/cs-case-comments.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/core/src/modules/customer-service/controllers/cs-case-labels.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/core/src/modules/customer-service/controllers/cs-cases.controller.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/core/src/modules/customer-service/controllers/cs-labels.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/core/src/modules/library/clients/file-service.client.ts': { count: 1, kind: 'system-identity' },
  'apps/core/src/modules/library/controllers/ownership-admin.controller.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/core/src/modules/product-matching/guards/new-sku-scope.guard.ts': { count: 2, kind: 'legacy-checkpoint' },
  'apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts': {
    count: 1,
    kind: 'data-value',
  },
  'apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts': {
    count: 1,
    kind: 'system-identity',
  },
  'apps/core/src/modules/sales-order/controllers/admin-return-exchange.controller.ts': { count: 1, kind: 'data-value' },
  'apps/core/src/modules/sales-order/dto/cancel-sales-order.dto.ts': { count: 1, kind: 'data-value' },
  'apps/core/src/modules/sales-order/services/sales-orders.service.ts': { count: 1, kind: 'system-identity' },
  'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts': { count: 2, kind: 'data-value' },
  'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts': { count: 6, kind: 'system-identity' },
  'apps/core/src/platform/auth/fulfillment-authz.ts': { count: 5, kind: 'legacy-checkpoint' },
  'apps/core/src/platform/auth/fulfillment-scopes.ts': { count: 2, kind: 'role-mapping' },
  'apps/core/src/platform/auth/inventory-scopes.ts': { count: 3, kind: 'role-mapping' },
  'apps/file-service/src/access/file-access.ts': { count: 4, kind: 'legacy-checkpoint' },
  'apps/membership/src/config/swagger.config.ts': { count: 1, kind: 'data-value' },
  'apps/membership/src/controllers/admin-operations.controller.ts': { count: 3, kind: 'legacy-checkpoint' },
  'apps/membership/src/shared/auth/membership-scopes.ts': { count: 2, kind: 'role-mapping' },
  'apps/membership/src/shared/decorators/admin-auth.decorator.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/notification/src/alimtalk/controllers/alimtalk-auto-notices.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/notification/src/alimtalk/controllers/alimtalk-campaigns.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/notification/src/alimtalk/controllers/alimtalk-templates.controller.ts': {
    count: 2,
    kind: 'legacy-route-guard',
  },
  'apps/notification/src/dispatcher/handlers/order-event.consumer.ts': { count: 1, kind: 'data-value' },
  'apps/notification/src/provider/dto/update-provider.dto.ts': { count: 1, kind: 'data-value' },
  'apps/notification/src/template/dto/create-template.dto.ts': { count: 1, kind: 'data-value' },
  'apps/ugc-service/src/almond-template/clients/service-token.ts': { count: 1, kind: 'system-identity' },
  'apps/ugc-service/src/review-permissions/review-permission.service.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/review-permissions/types.ts': { count: 1, kind: 'data-value' },
  'apps/ugc-service/src/reviews/dto/admin-review-response.dto.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/reviews/dto/review-list-query.dto.ts': { count: 3, kind: 'data-value' },
  'apps/ugc-service/src/shared/auth/ugc-scopes.ts': { count: 4, kind: 'role-mapping' },
  'apps/ugc-service/src/shop-listings/dto/shop-listing-response.dto.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/shop-listing-moderation.manager.ts': { count: 1, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/shop-listing.constants.ts': { count: 2, kind: 'data-value' },
  'apps/ugc-service/src/shop-listings/shop-listing.manager.ts': { count: 1, kind: 'data-value' },
  'apps/user-service/src/api/admin/auth/auth.controller.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/admin/auth/auth.service.ts': { count: 1, kind: 'legacy-checkpoint' },
  'apps/user-service/src/api/admin/blacklists/blacklists.controller.ts': { count: 4, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts': {
    count: 6,
    kind: 'legacy-route-guard',
  },
  'apps/user-service/src/api/admin/dormant/dormant.controller.ts': { count: 1, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts': { count: 7, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/admin/shop/shop.controller.ts': { count: 1, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/admin/users/users.controller.ts': { count: 6, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/auth/auth.controller.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/consents/consents.controller.ts': { count: 3, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/events/event-trace.controller.ts': { count: 2, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts': { count: 6, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/iam/audit/iam-audit.controller.ts': { count: 1, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/iam/iam.constants.ts': { count: 1, kind: 'system-role-rule' },
  'apps/user-service/src/api/iam/roles/role-admin.controller.ts': { count: 6, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/shop/shop.controller.ts': { count: 4, kind: 'legacy-route-guard' },
  'apps/user-service/src/api/users/users.controller.ts': { count: 3, kind: 'legacy-route-guard' },
  'apps/user-service/src/app.module.ts': { count: 5, kind: 'role-mapping' },
  'apps/wallet/src/admin/refund-admin.controller.ts': { count: 1, kind: 'data-value' },
  'apps/wallet/src/admin/refund-requests-admin.controller.ts': { count: 2, kind: 'data-value' },
  'apps/wallet/src/wallet.module.ts': { count: 2, kind: 'legacy-route-guard' },
  'libs/authorization/src/guards/admin-realm.guard.ts': { count: 2, kind: 'legacy-library' },
  'libs/authorization/src/guards/master-role.guard.ts': { count: 1, kind: 'legacy-library' },
  'libs/authorization/src/guards/scope.guard.ts': { count: 2, kind: 'legacy-library' },
  'libs/authorization/src/permissions/permission-catalog.ts': { count: 18, kind: 'role-mapping' },
  'libs/authorization/src/permissions/permission.types.ts': { count: 4, kind: 'role-mapping' },
  'libs/authorization/src/services/authorization.service.ts': { count: 3, kind: 'legacy-library' },
};
