import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { addToCartWorkflow } from '@medusajs/medusa/core-flows';
import { MedusaError } from '@medusajs/utils';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  console.log('들어옴 ');
  const { id } = req.params;
  const cartService = req.scope.resolve(Modules.CART);
  const cart = await cartService.retrieveCart(id, {
    relations: ['items', 'items.variant', 'items.variant.product'],
  });
  console.log('cart', cart);
  res.json(cart);
}

/**
 * 카트의 상세 정보(예: region, customer, 주소 등)를 업데이트할 때 사용합니다.
 * 이 엔드포인트는 상품 추가/수정이 아니라, 카트 자체의 속성(예: region 변경, 고객 정보 연결, 주소 변경 등)을 수정할 때 사용됩니다.
 * 예를 들어:
 * region_id, customer_id, sales_channel_id, email, 주소 등 카트의 메타 정보를 변경할 때 사용합니다.
 * 게스트가 로그인한 후 customer_id를 연결하거나, region을 변경하는 등의 작업에 사용됩니다.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {}
