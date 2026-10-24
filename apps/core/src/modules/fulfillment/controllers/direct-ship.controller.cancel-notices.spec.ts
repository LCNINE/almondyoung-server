import { Server } from 'http';
import { Request } from 'express';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import { DirectShipController } from './direct-ship.controller';
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

  it('본문과 사용자가 맞으면 서비스에 (업체, id들, 사용자) 를 넘기고 2xx', async () => {
    const res = await post().set('x-test-user', 'user-1').send({ companyName: '업체', noticeIds: ids }).expect(201);
    expect(res.body).toEqual({ notified: 2 });
    expect(markNotified).toHaveBeenCalledWith('업체', ids, 'user-1');
  });

  it('본문이 틀리면 400', async () => {
    await post().set('x-test-user', 'user-1').send({ companyName: '', noticeIds: ids }).expect(400);
    await post()
      .set('x-test-user', 'user-1')
      .send({ companyName: '업체', noticeIds: ['x'] })
      .expect(400);
    expect(markNotified).not.toHaveBeenCalled();
  });

  it('사용자 id 가 없으면 400', async () => {
    await post().set('x-test-user-empty', '1').send({ companyName: '업체', noticeIds: ids }).expect(400);
    await post().send({ companyName: '업체', noticeIds: ids }).expect(400);
    expect(markNotified).not.toHaveBeenCalled();
  });
});
