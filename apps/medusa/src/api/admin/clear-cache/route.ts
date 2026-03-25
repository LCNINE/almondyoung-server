import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';

interface ClearCacheBody {
  // 특정 상품 ID들 (예: ["prod_123", "prod_456"])
  productIds?: string[];
  // 모든 상품 목록 캐시 초기화
  clearList?: boolean;
  // 커스텀 태그들 (직접 지정)
  tags?: string[];
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const cachingModuleService = req.scope.resolve(Modules.CACHING);
    const body = req.body as ClearCacheBody;

    const tagsToClean: string[] = [];

    // 특정 상품 ID들 처리
    if (body.productIds && body.productIds.length > 0) {
      for (const productId of body.productIds) {
        tagsToClean.push(`Product:${productId}`);
      }
    }

    // 모든 상품 목록 캐시 초기화
    if (body.clearList) {
      tagsToClean.push('Product:list:*');
    }

    // 커스텀 태그들 추가
    if (body.tags && body.tags.length > 0) {
      tagsToClean.push(...body.tags);
    }

    // 아무 옵션도 없으면 에러
    if (tagsToClean.length === 0) {
      return res.status(400).json({
        message: '최소 하나의 옵션을 지정해야 합니다. (productIds, clearList, tags)',
      });
    }

    await cachingModuleService.clear({ tags: tagsToClean });

    res.json({
      message: '캐시가 초기화되었습니다.',
      clearedTags: tagsToClean,
    });
  } catch (error) {
    res.status(500).json({
      message: '캐시 초기화 중 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}
