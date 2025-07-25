// import { MedusaError } from '@medusajs/framework/utils';
// import {
//   addToCartWorkflow,
//   createCartWorkflow,
// } from '@medusajs/medusa/core-flows';
// import { WMS_MODULE } from '../../../modules/wms';
// import { WmsModuleService } from '../../../modules/wms/service';
// import { Modules } from '@medusajs/framework/utils';

// const validateInventory = async ({ input }, { container }) => {
//   const wmsService: WmsModuleService = container.resolve(WMS_MODULE);
//   const productModuleService = container.resolve(Modules.PRODUCT);

//   const variants = await productModuleService.listProductVariants(
//     {
//       id: input.items
//         ?.map((item) => item.variant_id)
//         .filter(Boolean) as string[],
//     },
//     { relations: ['product'] },
//   );

//   if (!variants?.length) return;

//   const errors: MedusaError[] = [];

//   await Promise.all(
//     variants.map(async (variant) => {
//       const item = input.items.find((i) => i.variant_id === variant.id)!;
//       const skuId = variant.sku;
//       const productName = variant.product?.title || variant.id;

//       if (!skuId) {
//         errors.push(
//           new MedusaError(
//             MedusaError.Types.INVALID_DATA,
//             `${productName}: SKU ID가 설정되지 않아 재고 확인이 불가능합니다`,
//           ),
//         );
//         return;
//       }

//       try {
//         const isAvailable = await wmsService.checkAvailableForCart(
//           skuId,
//           Number(item.quantity),
//         );

//         if (!isAvailable) {
//           errors.push(
//             new MedusaError(
//               MedusaError.Types.NOT_ALLOWED,
//               `${productName}: 재고가 부족합니다`,
//             ),
//           );
//         }
//       } catch (error) {
//         console.error('[validate-inventory] WMS 에러:', {
//           skuId,
//           productName,
//           error: error.message,
//           type: error.type,
//         });

//         if (error instanceof MedusaError) {
//           errors.push(error);
//         } else {
//           // 일반 에러인 경우 MedusaError로 래핑
//           errors.push(
//             new MedusaError(
//               MedusaError.Types.INVALID_DATA,
//               error.message || '재고 확인 중 오류가 발생했습니다',
//             ),
//           );
//         }
//       }
//     }),
//   );

//   // 에러가 있으면 첫 번째 에러를 던짐
//   if (errors.length > 0) {
//     throw errors[0];
//   }
// };

// // 장바구니 생성 시 재고 검증
// createCartWorkflow.hooks.validate(validateInventory);

// // 장바구니에 상품 추가 시 재고 검증
// addToCartWorkflow.hooks.validate(validateInventory);
