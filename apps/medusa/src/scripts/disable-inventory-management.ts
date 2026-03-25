/**
 * 모든 상품 variant의 재고관리(manage_inventory)를 비활성화하는 스크립트
 *
 * 실행 후 모든 variant가 재고량과 무관하게 항상 판매 가능 상태가 됩니다.
 *
 * 실행 방법:
 *   yarn medusa exec ./src/scripts/disable-inventory-management.ts
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

export default async function disableInventoryManagement({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModuleService = container.resolve(Modules.PRODUCT);

  logger.info('[disable-inventory] 모든 variant 조회 중...');

  // 페이지네이션으로 모든 variant 가져오기
  const limit = 100;
  let totalUpdated = 0;

  while (true) {
    const variants = await productModuleService.listProductVariants(
      // { manage_inventory: true },
      {},
      { take: limit, skip: 0 },
    );

    if (variants.length === 0) {
      break;
    }

    logger.info(`[disable-inventory] ${totalUpdated + 1}~${totalUpdated + variants.length}번째 variant 처리 중...`);

    const variantIds = variants.map((v) => v.id);

    await productModuleService.updateProductVariants({ id: variantIds }, { manage_inventory: false });

    totalUpdated += variants.length;

    // 마지막 페이지면 종료
    if (variants.length < limit) {
      break;
    }
  }

  if (totalUpdated === 0) {
    logger.info('[disable-inventory] 재고관리가 활성화된 variant가 없습니다. 작업 불필요.');
  } else {
    logger.info(`[disable-inventory] 완료. 총 ${totalUpdated}개 variant의 재고관리를 비활성화했습니다.`);
  }
}
