import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { getOrdersListWorkflow } from '@medusajs/core-flows';

// 표준 /store/orders 는 쿼리 validator 가 strict 라 created_at 필터를 거부한다(400).
// 대규모 주문 이력에서 기간별 조회를 서버에서 처리하기 위한 커스텀 목록 엔드포인트.
// 코어 라우트와 동일하게 getOrdersListWorkflow + customer_id 스코핑을 쓰되,
// 미들웨어(validateAndTransformQuery + 확장 validator)가 created_at 을 허용하고
// fields(*items, +payment_collections... 등)를 정규화해 req.queryConfig/filterableFields 로 넘겨준다.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  // q 는 컬럼 필터가 아니라 상품명 검색어 — items.title ilike 로 변환한다.
  const { q, ...filterableFields } = req.filterableFields as Record<string, unknown> & {
    q?: string;
  };

  const filters: Record<string, unknown> = {
    ...filterableFields, // created_at, status 등 검증된 필터
    is_draft_order: false,
    // 인증된 고객 본인 주문만
    customer_id: req.auth_context.actor_id,
  };

  if (typeof q === 'string' && q.trim()) {
    // LIKE 특수문자(\ % _) 이스케이프 후 부분일치
    const escaped = q.trim().replace(/[\\%_]/g, (m) => `\\${m}`);
    filters.items = { title: { $ilike: `%${escaped}%` } };
  }

  const variables = {
    filters,
    ...req.queryConfig.pagination,
  };

  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: {
      fields: req.queryConfig.fields,
      variables,
    },
  });

  const { rows, metadata } = result as {
    rows: unknown[];
    metadata: { count: number; skip: number; take: number };
  };

  res.json({
    orders: rows,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  });
}
