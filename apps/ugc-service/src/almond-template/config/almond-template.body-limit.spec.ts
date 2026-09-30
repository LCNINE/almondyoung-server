import { Body, Controller, Post, Put } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyInstance } from 'fastify';
import { raiseAlmondRouteBodyLimits } from './almond-template.body-limit';

@Controller('admin/almond-templates')
class UpsertStubController {
  @Put()
  upsert(@Body() body: { payload: string }): number {
    return body.payload.length;
  }

  @Post()
  create(@Body() body: { payload: string }): number {
    return body.payload.length;
  }
}

@Controller('almond-designs')
class DesignStubController {
  @Post()
  create(@Body() body: { payload: string }): number {
    return body.payload.length;
  }

  @Put()
  replace(@Body() body: { payload: string }): number {
    return body.payload.length;
  }
}

describe('아몬드템플릿 라우트 본문 상한', () => {
  let app: NestFastifyApplication;
  const payload = JSON.stringify({ payload: 'a'.repeat(2 * 1024 * 1024) });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UpsertStubController, DesignStubController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
    raiseAlmondRouteBodyLimits(fastify);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('PUT 은 전역 기본값(1MB)을 넘는 본문을 받는다', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/almond-templates',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(200);
  });

  it('같은 경로의 다른 메서드는 기본값 그대로다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/almond-templates',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(413);
  });

  it('고객 시안 저장(POST /almond-designs)은 전역 기본값을 넘는 본문을 받는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/almond-designs',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(201);
  });

  it('고객 시안 저장도 5MB 를 넘으면 거부한다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/almond-designs',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ payload: 'a'.repeat(6 * 1024 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('고객 시안 경로의 다른 메서드는 기본값 그대로다', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/almond-designs',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(413);
  });
});
