import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalSalesController } from './internal-sales.controller';
import { ProductIndexService } from './product-index.service';

describe('InternalSalesController', () => {
  const makeController = (key: string | undefined, applied = 1) => {
    const productIndexService = {
      updateProductSalesCounts: jest.fn().mockResolvedValue(applied),
    } as unknown as ProductIndexService;
    const configService = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
    return {
      controller: new InternalSalesController(productIndexService, configService),
      productIndexService,
    };
  };

  const body = { items: [{ masterId: 'master-1', salesCount: 7 }] };

  it('올바른 키면 색인에 반영하고 건수를 돌려준다', async () => {
    const { controller, productIndexService } = makeController('secret');

    await expect(controller.updateSalesCounts('Bearer secret', body)).resolves.toEqual({
      received: 1,
      applied: 1,
    });
    expect(productIndexService.updateProductSalesCounts).toHaveBeenCalledWith([
      { masterId: 'master-1', salesCount: 7 },
    ]);
  });

  it('키가 틀리면 거부한다', async () => {
    const { controller, productIndexService } = makeController('secret');

    await expect(controller.updateSalesCounts('Bearer wrong', body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(productIndexService.updateProductSalesCounts).not.toHaveBeenCalled();
  });

  it('Authorization 헤더가 없으면 거부한다', async () => {
    const { controller } = makeController('secret');

    await expect(controller.updateSalesCounts(undefined, body)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // 설정 누락이 무인증 쓰기로 이어지면 안 된다 (fail-closed)
  it('SEARCH_INTERNAL_KEY 미설정이면 아무 요청도 받지 않는다', async () => {
    const { controller, productIndexService } = makeController(undefined);

    await expect(controller.updateSalesCounts('Bearer anything', body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(productIndexService.updateProductSalesCounts).not.toHaveBeenCalled();
  });
});
