import { BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { StockProjectionController } from './stock-projection.controller';

const skuA = '22222222-2222-2222-2222-222222222222';
const skuB = '33333333-3333-3333-3333-333333333333';

describe('StockProjectionController inbound-pipeline input validation', () => {
  function makeController(getInboundPipeline = jest.fn().mockResolvedValue({ items: [] })) {
    return {
      controller: new StockProjectionController({ getInboundPipeline } as never),
      getInboundPipeline,
    };
  }

  // 형식 검증이 없으면 잘못된 UUID 가 Postgres 22P02 로 터져 400 이어야 할 입력 오류가 500 이 된다.
  it('warehouseId 에 ParseUUIDPipe 가 걸려 있다', () => {
    const routeArgs = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      StockProjectionController,
      'getInboundPipeline',
    ) as Record<string, { pipes?: unknown[] }>;
    const pipes = Object.values(routeArgs).flatMap((value) => value.pipes ?? []);
    expect(
      pipes.some((pipe) => (pipe as { constructor?: { name?: string } })?.constructor?.name === 'ParseUUIDPipe'),
    ).toBe(true);
  });

  it('skuIds 에 UUID 가 아닌 값이 섞이면 400 을 던진다', async () => {
    const { controller, getInboundPipeline } = makeController();

    await expect(
      controller.getInboundPipeline('11111111-1111-1111-1111-111111111111', `${skuA},not-a-uuid`),
    ).rejects.toThrow(BadRequestException);
    expect(getInboundPipeline).not.toHaveBeenCalled();
  });

  // 기본 창고 id 는 RFC-4122 version/variant 니블이 없다. class-validator 의 isUUID 는
  // 이것을 거부하므로, 그 판정을 쓰면 실제 운영 창고 조회가 통째로 400 이 된다.
  it('기본 창고 id 처럼 version 니블이 없는 UUID 도 통과시킨다', async () => {
    const { controller, getInboundPipeline } = makeController();

    await controller.getInboundPipeline('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009');

    expect(getInboundPipeline).toHaveBeenCalledWith({
      skuIds: ['00000000-0000-0000-0000-000000000009'],
      toWarehouseId: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('skuIds 가 비면 400 을 던진다', async () => {
    const { controller } = makeController();

    await expect(controller.getInboundPipeline('11111111-1111-1111-1111-111111111111', '')).rejects.toThrow(
      'skuIds is required',
    );
  });

  it('정상 입력은 쉼표 구분을 분해해 서비스로 넘긴다', async () => {
    const { controller, getInboundPipeline } = makeController();

    await controller.getInboundPipeline('11111111-1111-1111-1111-111111111111', `${skuA}, ${skuB}`);

    expect(getInboundPipeline).toHaveBeenCalledWith({
      skuIds: [skuA, skuB],
      toWarehouseId: '11111111-1111-1111-1111-111111111111',
    });
  });
});
