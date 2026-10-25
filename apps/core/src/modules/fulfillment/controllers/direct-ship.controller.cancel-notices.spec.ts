import { Server } from 'http';
import { Request } from 'express';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';

const SUPPLIER = randomUUID();
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { DirectShipController } from './direct-ship.controller';
import { SupplierHandoffService } from '../supplier-shipment/supplier-handoff.service';
import { SupplierSheetApplyService } from '../supplier-shipment/supplier-sheet-apply.service';
import { SupplierHandoffListReader } from '../supplier-shipment/supplier-handoff-list.reader';
import { SupplierShipmentQueueReader } from '../supplier-shipment/supplier-shipment-queue.reader';
import { DirectShipService } from '../services/direct-ship.service';
import { DirectShipCancelNoticeService } from '../direct-ship-cancel-notice/direct-ship-cancel-notice.service';

// @UsePipes 가 @User() 파라미터까지 지나가면 사용자 객체가 본문 스키마로 파싱돼 늘 400 이 된다 — Nest 파이프 줄을 실제로 태운다.
describe('POST /direct-ship/cancel-notices/notified', () => {
  let app: INestApplication;
  const markNotified = jest.fn().mockResolvedValue({ notified: 2 });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DirectShipController],
      providers: [
        { provide: DirectShipService, useValue: {} },
        { provide: SupplierShipmentQueueReader, useValue: {} },
        { provide: SupplierHandoffListReader, useValue: {} },
        { provide: SupplierHandoffService, useValue: {} },
        { provide: SupplierSheetApplyService, useValue: {} },
        { provide: DirectShipCancelNoticeService, useValue: { markNotified } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: Request & { user?: Record<string, string> }, _res: unknown, next: () => void) => {
      const id = req.headers['x-test-user'];
      if (typeof id === 'string') req.user = { userId: id };
      else if (req.headers['x-test-user-empty']) req.user = {};
      next();
    });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => markNotified.mockClear());

  const ids = [randomUUID(), randomUUID()];
  const post = () => request(app.getHttpServer() as Server).post('/direct-ship/cancel-notices/notified');

  it('본문과 사용자가 맞으면 서비스에 (입점사 id, id들, 사용자) 를 넘기고 2xx', async () => {
    const res = await post().set('x-test-user', 'user-1').send({ supplierId: SUPPLIER, noticeIds: ids }).expect(201);
    expect(res.body).toEqual({ notified: 2 });
    expect(markNotified).toHaveBeenCalledWith(SUPPLIER, ids, 'user-1');
  });

  it('본문이 틀리면 400', async () => {
    await post().set('x-test-user', 'user-1').send({ supplierId: 'not-a-uuid', noticeIds: ids }).expect(400);
    // 옛 화면의 본문(입점사 이름) — 이름으로 찾지 않는다(K3 PR6 N6)
    await post().set('x-test-user', 'user-1').send({ companyName: '업체', noticeIds: ids }).expect(400);
    await post()
      .set('x-test-user', 'user-1')
      .send({ supplierId: SUPPLIER, noticeIds: ['x'] })
      .expect(400);
    expect(markNotified).not.toHaveBeenCalled();
  });

  it('사용자 id 가 없으면 400', async () => {
    await post().set('x-test-user-empty', '1').send({ supplierId: SUPPLIER, noticeIds: ids }).expect(400);
    await post().send({ supplierId: SUPPLIER, noticeIds: ids }).expect(400);
    expect(markNotified).not.toHaveBeenCalled();
  });
});

describe('POST /direct-ship/cancel-notices/export/file', () => {
  let app: INestApplication;
  const exportFile = jest.fn().mockResolvedValue({
    fileName: '직배취소알림.csv',
    content: Buffer.from('a,b'),
    mimeType: 'text/csv; charset=utf-8',
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DirectShipController],
      providers: [
        { provide: DirectShipService, useValue: {} },
        { provide: SupplierShipmentQueueReader, useValue: {} },
        { provide: SupplierHandoffListReader, useValue: {} },
        { provide: SupplierHandoffService, useValue: {} },
        { provide: SupplierSheetApplyService, useValue: {} },
        { provide: DirectShipCancelNoticeService, useValue: { exportFile } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => exportFile.mockClear());

  const ids = [randomUUID()];
  const post = () => request(app.getHttpServer() as Server).post('/direct-ship/cancel-notices/export/file');

  it('본문이 맞으면 (입점사 id, id들) 을 넘기고 200 text/csv', async () => {
    const res = await post().send({ supplierId: SUPPLIER, noticeIds: ids }).expect(201);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(exportFile).toHaveBeenCalledWith(SUPPLIER, ids);
  });

  it('본문이 틀리면(id 없음·uuid 아님·입점사 id 아님·옛 이름 본문) 400', async () => {
    await post().send({ supplierId: SUPPLIER }).expect(400);
    await post().send({ supplierId: SUPPLIER, noticeIds: [] }).expect(400);
    await post()
      .send({ supplierId: SUPPLIER, noticeIds: ['x'] })
      .expect(400);
    await post().send({ supplierId: '', noticeIds: ids }).expect(400);
    await post().send({ companyName: '업체', noticeIds: ids }).expect(400);
    expect(exportFile).not.toHaveBeenCalled();
  });
});

describe('GET /direct-ship/cancel-notices', () => {
  let app: INestApplication;
  const listOpen = jest.fn().mockResolvedValue([]);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DirectShipController],
      providers: [
        { provide: DirectShipService, useValue: {} },
        { provide: SupplierShipmentQueueReader, useValue: {} },
        { provide: SupplierHandoffListReader, useValue: {} },
        { provide: SupplierHandoffService, useValue: {} },
        { provide: SupplierSheetApplyService, useValue: {} },
        { provide: DirectShipCancelNoticeService, useValue: { listOpen } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => listOpen.mockClear());

  const get = (query: Record<string, string> = {}) =>
    request(app.getHttpServer() as Server)
      .get('/direct-ship/cancel-notices')
      .query(query);

  it('입점사 id 로 거르거나 전부 — 서비스에 그대로 넘긴다', async () => {
    await get({ supplierId: SUPPLIER }).expect(200);
    await get().expect(200);
    expect(listOpen.mock.calls).toEqual([[{ supplierId: SUPPLIER }], [{ supplierId: undefined }]]);
  });

  it('입점사 id 가 uuid 가 아니면 400', async () => {
    await get({ supplierId: '업체' }).expect(400);
    expect(listOpen).not.toHaveBeenCalled();
  });
});
