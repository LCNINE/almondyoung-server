import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const productModuleService = req.scope.resolve(Modules.PRODUCT);

  const { id, title, take = 20, skip = 0 } = req.query;

  const selector: any = {};

  if (id) selector.id = Array.isArray(id) ? id : [id];
  if (title) selector.title = title;

  const options: any = {
    take: Number(take),
    skip: Number(skip),
    relations: ['categories'],
  };

  const [products, count] = await productModuleService.listAndCountProducts(
    selector,
    options,
  );

  res.json({ products, count, take: options.take, skip: options.skip });
}
