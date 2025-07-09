import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';

/**
 * 상품 상세 조회
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const productModuleService = req.scope.resolve(Modules.PRODUCT);

  const { id } = req.params;

  const selector: any = {};

  if (id) selector.id = Array.isArray(id) ? id : [id];

  const options: any = {
    relations: ['categories'],
  };

  const product = await productModuleService.retrieveProduct(id, options);

  res.json(product);
}
