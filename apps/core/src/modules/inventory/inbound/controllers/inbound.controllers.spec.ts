import { randomUUID } from 'crypto';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ScopeGuard } from '@app/authorization';
import { createGlobalValidationPipe } from '../../../../platform/http/validation-pipe';
import { InboundController } from './inbound.controllers';
import { InboundService } from '../services/inbound.service';
import { InboundPutawayReader } from '../services/inbound-putaway.reader';
import type { InboundReceiptHistoryResponseDto } from '../dto/inbound-response.dto';

/**
 * GET /inbound/putaway/pending 의 days 파싱 경계 검증.
 *
 * `Number('1e21')` 은 `Number.isInteger` 를 통과하는데, 그 값으로 만든 Date 는
 * Invalid Date 가 되고 응답 직렬화(`toISOString`)에서 RangeError → 500 이 났다.
 * 그렇다고 `parseInt` 로 바꾸면 '1e21' → 1, '12abc' → 12 처럼 숫자 아닌 접미사를
 * 조용히 잘라먹고 통과시킨다 — 옛 `Number()` 는 이런 입력에 NaN → 400 이었으니
 * 오히려 계약이 느슨해진 것이다. `/^\d+$/` 로 순수 숫자 문자열만 허용한 뒤
 * parseInt 하면 둘 다 정직하게 400 이 되고, 상한(365)은 별도로 필요하다
 * (parseInt('99999') 같은 큰 정수는 자릿수 검사를 통과하니까).
 */
describe('InboundController.listPutawayPending — days 파싱', () => {
  function makeController() {
    const listPending = jest.fn().mockResolvedValue({ total: 0, truncated: false, items: [] });
    const putawayReader = { listPending } as unknown as InboundPutawayReader;
    const controller = new InboundController({} as unknown as InboundService, putawayReader);
    return { controller, listPending };
  }

  it.each(['bad', '', ['00000000-0000-4000-8000-000000000001']])(
    'rejects malformed warehouseId (case %#)',
    async (warehouseId) => {
      const { controller } = makeController();
      await expect(controller.listPutawayPending(warehouseId as string, undefined)).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it('rejects repeated days query parameters', async () => {
    const { controller } = makeController();
    await expect(
      controller.listPutawayPending('00000000-0000-4000-8000-000000000001', ['1'] as unknown as string),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    '',
    'not-a-uuid',
    `${randomUUID()},`,
    `${randomUUID()},bad`,
    Array.from({ length: 101 }, () => randomUUID()).join(','),
  ])('rejects malformed or unbounded skuIds (case %#)', async (skuIds) => {
    const { controller } = makeController();
    await expect(
      controller.listPutawayPending('00000000-0000-4000-8000-000000000001', undefined, skuIds),
    ).rejects.toThrow(BadRequestException);
  });

  it('normalizes and deduplicates multiple barcode SKU matches', async () => {
    const { controller, listPending } = makeController();
    const first = randomUUID();
    const second = randomUUID();
    await controller.listPutawayPending(
      '00000000-0000-4000-8000-000000000001',
      undefined,
      `${first.toUpperCase()},${second},${first}`,
      'opaque-cursor',
    );
    expect(listPending).toHaveBeenCalledWith({
      warehouseId: '00000000-0000-4000-8000-000000000001',
      days: undefined,
      skuIds: [first, second],
      cursor: 'opaque-cursor',
    });
  });

  it('warehouseId 가 없으면 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending(undefined, undefined)).rejects.toThrow(BadRequestException);
  });

  it("'1e21' 처럼 지수표기 문자열은 400 이다(parseInt 로 조용히 1 을 받지 않는다)", async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('00000000-0000-4000-8000-000000000001', '1e21')).rejects.toThrow(
      BadRequestException,
    );
  });

  it("'12abc' 처럼 숫자 뒤에 쓰레기가 붙은 문자열도 400 이다(parseInt 로 조용히 12 를 받지 않는다)", async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('00000000-0000-4000-8000-000000000001', '12abc')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('365 초과는 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('00000000-0000-4000-8000-000000000001', '366')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('365 는 통과한다', async () => {
    const { controller, listPending } = makeController();
    await controller.listPutawayPending('00000000-0000-4000-8000-000000000001', '365');
    expect(listPending).toHaveBeenCalledWith({
      warehouseId: '00000000-0000-4000-8000-000000000001',
      days: 365,
      skuIds: undefined,
      cursor: undefined,
    });
  });

  it('정수가 아닌 문자열은 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('00000000-0000-4000-8000-000000000001', 'abc')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('0 이하는 400', async () => {
    const { controller } = makeController();
    await expect(controller.listPutawayPending('00000000-0000-4000-8000-000000000001', '0')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('days 미지정이면 전체 기간으로 리더를 호출한다', async () => {
    const { controller, listPending } = makeController();
    await controller.listPutawayPending('00000000-0000-4000-8000-000000000001', undefined);
    expect(listPending).toHaveBeenCalledWith({
      warehouseId: '00000000-0000-4000-8000-000000000001',
      days: undefined,
      skuIds: undefined,
      cursor: undefined,
    });
  });
});

/** 입고예정은 발주 라인이 소유하고, 수령은 발주 라우트가 소유한다(PR-B). */
describe('InboundController — 계획 생성 라우트', () => {
  type Handlers = Record<string, unknown>;

  it('POST /inbound/plans 핸들러는 없다 (계획 생성은 발주 라인 실행이 소유한다)', () => {
    expect((InboundController.prototype as unknown as Handlers).createPlan).toBeUndefined();
  });

  it.each(['receiveFromPlan', 'getInboundPending', 'addPlanItems', 'listPlanItems', 'closePlanItem'])(
    '%s 핸들러는 없다 — 입고예정은 발주 라인이고 수령은 발주 라우트가 소유한다(PR-B)',
    (handler) => {
      expect((InboundController.prototype as unknown as Handlers)[handler]).toBeUndefined();
    },
  );
});

describe('InboundController.listInboundReceipts — 회차별 이력 계약', () => {
  it('기존 query를 보존하고 limit/offset을 숫자로 바꿔 typed grouped response를 반환한다', async () => {
    const response: InboundReceiptHistoryResponseDto = {
      serverTime: '2026-09-15T00:00:00.000Z',
      total: 0,
      items: [],
    };
    const listInboundReceipts = jest.fn().mockResolvedValue(response);
    const controller = new InboundController(
      { listInboundReceipts } as unknown as InboundService,
      {} as unknown as InboundPutawayReader,
    );

    await expect(
      controller.listInboundReceipts({
        skuId: '00000000-0000-4000-8000-000000000001',
        warehouseId: '00000000-0000-4000-8000-000000000002',
        method: 'planned',
        startDate: '2026-09-01',
        endDate: '2026-09-14',
        limit: 20,
        offset: 40,
      }),
    ).resolves.toBe(response);
    expect(listInboundReceipts).toHaveBeenCalledWith({
      skuId: '00000000-0000-4000-8000-000000000001',
      warehouseId: '00000000-0000-4000-8000-000000000002',
      method: 'planned',
      startDate: '2026-09-01',
      endDate: '2026-09-14',
      limit: 20,
      offset: 40,
    });
  });
});

describe('GET /inbound/receipts — 조회 조건 검증', () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  const listInboundReceipts = jest.fn().mockResolvedValue({
    serverTime: '2026-09-15T00:00:00.000Z',
    total: 0,
    items: [],
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InboundController],
      providers: [
        { provide: InboundService, useValue: { listInboundReceipts } },
        { provide: InboundPutawayReader, useValue: {} },
      ],
    })
      .overrideGuard(ScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    httpServer = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    listInboundReceipts.mockClear();
  });

  it.each([
    ['skuId', 'not-a-uuid'],
    ['warehouseId', 'not-a-uuid'],
    ['receiptId', 'not-a-uuid'],
    ['status', 'missing'],
    ['startDate', '2026-02-30'],
    ['startDate', '2026-09-15T00:00:00Z'],
    ['endDate', '2026-13-01'],
    ['limit', '0'],
    ['limit', '101'],
    ['offset', '-1'],
  ])('rejects invalid %s=%s with 400', async (key, value) => {
    await request(httpServer)
      .get('/inbound/receipts')
      .query({ [key]: value })
      .expect(400);
    expect(listInboundReceipts).not.toHaveBeenCalled();
  });

  it('requires warehouseId when receiptId is used', async () => {
    await request(httpServer).get('/inbound/receipts').query({ receiptId: randomUUID() }).expect(400);
    expect(listInboundReceipts).not.toHaveBeenCalled();
  });

  it('rejects an inverted Seoul calendar date range', async () => {
    await request(httpServer)
      .get('/inbound/receipts')
      .query({ startDate: '2026-09-16', endDate: '2026-09-15' })
      .expect(400);
    expect(listInboundReceipts).not.toHaveBeenCalled();
  });

  it('applies the default page and accepts the maximum page with all new filters', async () => {
    const skuId = randomUUID();
    const warehouseId = randomUUID();
    const receiptId = randomUUID();

    await request(httpServer).get('/inbound/receipts').query({ warehouseId }).expect(200);
    expect(listInboundReceipts).toHaveBeenLastCalledWith({ warehouseId, limit: 50, offset: 0 });

    await request(httpServer)
      .get('/inbound/receipts')
      .query({
        skuId,
        warehouseId,
        receiptId,
        method: 'planned',
        status: 'all',
        startDate: '2024-02-29',
        endDate: '2026-09-15',
        limit: '100',
        offset: '0',
      })
      .expect(200);
    expect(listInboundReceipts).toHaveBeenLastCalledWith({
      skuId,
      warehouseId,
      receiptId,
      method: 'planned',
      status: 'all',
      startDate: '2024-02-29',
      endDate: '2026-09-15',
      limit: 100,
      offset: 0,
    });
  });
});
