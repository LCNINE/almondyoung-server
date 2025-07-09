import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { createProductWorkflow } from '../../../workflows/products/workflows/create-product-workflow';
import {
  AdminCreateProduct,
  UpdateProductDTO,
} from '@medusajs/framework/types';

/**
 * 상품 목록 조회
 */
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

/**
 * 상품 생성
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const productModuleService = req.scope.resolve(Modules.PRODUCT);
    const { result } = await createProductWorkflow(req.scope).run({
      input: {
        input: req.body as AdminCreateProduct,
      },
    });

    res.send(result);
  } catch (error) {
    res.status(400).json({
      message: '상품 생성 중 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}

/**
 * 상품 수정
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  try {
    const productModuleService = req.scope.resolve(Modules.PRODUCT);
    const { id } = req.params;

    await productModuleService.updateProducts(id, req.body as UpdateProductDTO);

    res.send({ message: '상품이 수정되었습니다.' });
  } catch (error) {
    res.status(400).json({
      message: '상품 수정 중 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}

/**
 * 상품 삭제
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  try {
    const productModuleService = req.scope.resolve(Modules.PRODUCT);
    const { id } = req.params;

    await productModuleService.deleteProducts([id]);

    res.send({ message: '상품이 삭제되었습니다.' });
  } catch (error) {
    res.status(400).json({
      message: '상품 삭제 중 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}
