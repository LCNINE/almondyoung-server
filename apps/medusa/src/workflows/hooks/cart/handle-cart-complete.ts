//**
//  주문 단계에서 wms재고검증이 필요할 때 사용할 것
//  */

// import { Modules } from '@medusajs/framework/utils';
// import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
// import { StepResponse } from '@medusajs/workflows-sdk';
// import { WMS_MODULE } from '../../../modules/wms';
// import { WmsModuleService } from '../../../modules/wms/service';
// import { validateInventoryForItems } from '../../../utils/validate-inventory';

// completeCartWorkflow.hooks.validate(async ({ input }, { container }) => {
//   const { id } = input;
//   const cartService = container.resolve(Modules.CART);
//   const cart = await cartService.retrieveCart(id);

//   const shippingAddress = cart.shipping_address;
//   const billingAddress = cart.billing_address ?? shippingAddress;

//   if (!shippingAddress) {
//     throw new Error('배송 주소는 필수입니다.');
//   }

//   //WMS 재고 확인
//   const wmsService = container.resolve(WMS_MODULE) as WmsModuleService;

//   if (cart.items?.length) {
//     for (const item of cart.items) {
//       const productModuleService = container.resolve(Modules.PRODUCT);

//       const variants = await productModuleService.listProductVariants(
//         {
//           id: cart.items.map((item) => item.variant_id!),
//         },
//         { relations: ['product'] },
//       );

//       await validateInventoryForItems(
//         {
//           items: cart.items.map((item) => ({
//             variant_id: item.variant_id!,
//             quantity: Number(item.quantity),
//           })),
//           variants: variants.map((variant) => ({
//             id: variant.id,
//             sku: variant.sku || '',
//             product: {
//               title: variant.product?.title || '',
//             },
//           })),
//         },
//         container,
//       );
//     }
//   }

//   // 검증 통과
//   return new StepResponse(cart);
// });
