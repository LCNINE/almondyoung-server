import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { resolveMemberState } from '../../../utils/membership-filter';
import {
  loadMembershipHallRows,
  loadRootCategories,
  type MembershipHallRoot,
  parseMembershipHallQuery,
  resolveCategoryId,
  selectMembershipHall,
} from '../../../utils/membership-hall';
import { listActiveStoreTimeSales } from '../../../utils/time-sale';

/**
 * 멤버십관 상품 id 목록. 쿼리: tab(all|sale|discount), category(카테고리 handle 또는 id, 자손 포함),
 * sort(sales|discount|newest), limit, offset.
 *
 * 상품 본문은 싣지 않는다 — 스토어프론트가 id 로 `/store/products` 를 다시 부르게 해서 멤버십가 은닉·
 * 구매 게이트·가격 계산이 다른 목록과 똑같이 걸리게 한다. 회원 전용 노출 상품은 비회원 응답의
 * 목록과 개수에서 미리 뺀다(그래야 상품 수와 페이지가 맞는다).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseMembershipHallQuery(req.query);
  const [{ isMember }, { timeSales }, roots] = await Promise.all([
    resolveMemberState(req),
    listActiveStoreTimeSales(req.scope),
    loadRootCategories(req.scope),
  ]);

  const saleVariantIds = [...new Set(timeSales.flatMap((sale) => sale.membershipOnlyVariantIds))];
  const saleListIds = [...new Set(timeSales.flatMap((sale) => sale.priceListIds))];
  const [rows, categoryId] = await Promise.all([
    loadMembershipHallRows(req.scope, { saleListIds, saleVariantIds, excludeMembersOnly: !isMember }),
    findCategoryId(req, query.category, roots),
  ]);

  return res.json(selectMembershipHall(rows, query, categoryId, roots));
}

async function findCategoryId(
  req: AuthenticatedMedusaRequest,
  category: string | null,
  roots: MembershipHallRoot[],
): Promise<string | null> {
  if (!category) return null;

  const root = roots.find((item) => item.id === category || item.handle === category);

  return root ? root.id : resolveCategoryId(req.scope, category);
}
