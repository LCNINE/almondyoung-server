import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

/**
 * 멤버십 필터링이 적용된 상품 목록 API (Medusa 권장 방식)
 * 
 * - 기존 /store/products를 override하지 않고 새 경로로 제공
 * - 비멤버: isMembershipOnly=true 상품 제외
 * - 멤버십 회원: 모든 상품 노출
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

  // 멤버십 회원 여부 확인
  let isMember = false;
  const customerId = req.auth_context?.actor_id;

  if (customerId && membershipGroupId) {
    try {
      const { data: customers } = await query.graph({
        entity: 'customer',
        fields: ['id', 'groups.id'],
        filters: { id: customerId },
      });

      isMember =
        customers?.[0]?.groups?.some(
          (g: any) => g.id === membershipGroupId,
        ) ?? false;
    } catch (error) {
      console.error('[membership-products] 멤버십 확인 실패:', error);
    }
  }

  console.log(
    `[membership-products] customerId: ${customerId}, isMember: ${isMember}`,
  );

  // 쿼리 파라미터 가져오기
  const limit = parseInt(req.query.limit as string) || 12;
  const offset = parseInt(req.query.offset as string) || 0;
  const fields = req.query.fields as string;
  const region_id = req.query.region_id as string;
  const order = req.query.order as string;
  const category_id = req.query.category_id as string | string[];
  const collection_id = req.query.collection_id as string | string[];
  const tag_id = req.query.tag_id as string | string[];
  const q = req.query.q as string;

  try {
    // 기존 Medusa SDK를 통해 상품 조회
    const productsResponse = await fetch(
      `${process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000'}/store/products?${new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        fields: fields || '*variants.calculated_price,+variants.inventory_quantity,*variants.images,*variants.options,+variants.metadata,*options,*options.values,+metadata,*tags',
        ...(region_id && { region_id }),
        ...(order && { order }),
        ...(category_id && { category_id: Array.isArray(category_id) ? category_id.join(',') : category_id }),
        ...(collection_id && { collection_id: Array.isArray(collection_id) ? collection_id.join(',') : collection_id }),
        ...(tag_id && { tag_id: Array.isArray(tag_id) ? tag_id.join(',') : tag_id }),
        ...(q && { q }),
      })}`,
      {
        headers: req.headers as any,
      }
    );

    if (!productsResponse.ok) {
      throw new Error(`상품 조회 실패: ${productsResponse.status}`);
    }

    const data = await productsResponse.json();
    let { products, count } = data;

    // 비멤버인 경우 isMembershipOnly=true 상품 필터링
    if (!isMember) {
      const originalCount = products.length;
      products = products.filter((product: any) => {
        const isMembershipOnly =
          product.metadata?.isMembershipOnly === true ||
          product.metadata?.isMembershipOnly === 'true';
        return !isMembershipOnly;
      });
      const filteredCount = products.length;

      // 전체 count도 조정
      if (typeof count === 'number') {
        count = count - (originalCount - filteredCount);
      }

      console.log(
        `[membership-products] 필터링: ${originalCount}개 -> ${filteredCount}개 (제외: ${originalCount - filteredCount}개)`,
      );
    }

    return res.json({
      products,
      count,
      offset,
      limit,
    });
  } catch (error) {
    console.error('[membership-products] 상품 조회 실패:', error);

    return res.json({
      products: [],
      count: 0,
      offset,
      limit,
    });
  }
};
