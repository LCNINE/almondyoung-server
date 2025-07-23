import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';

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
