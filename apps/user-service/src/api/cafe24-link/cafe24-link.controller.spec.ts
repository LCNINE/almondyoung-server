import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ResponseInterceptor } from '@app/shared';
import * as request from 'supertest';
import { InternalApiKeyGuard } from '../../commons/guards/internal-api-key.guard';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { Cafe24LinkController } from './cafe24-link.controller';
import { Cafe24LinkService } from './cafe24-link.service';

describe('Cafe24LinkController internal routes', () => {
  let app: INestApplication;
  let internalKey: string | undefined;
  const linkInfo = { userId: 'user-1', email: 'user@example.com' };
  const links = [{ ...linkInfo, cafe24MemberId: 'member-1' }];
  const service = {
    getLinkInfoByCafe24MemberId: jest.fn().mockResolvedValue(linkInfo),
    getAllLinksByMallId: jest.fn().mockResolvedValue(links),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [Cafe24LinkController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        InternalApiKeyGuard,
        { provide: Cafe24LinkService, useValue: service },
        {
          provide: ConfigService,
          useValue: { get: (name: string) => (name === 'USER_SERVICE_INTERNAL_KEY' ? internalKey : undefined) },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    internalKey = 'test-key';
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const paths = [
    '/cafe24/internal/link-info?mallId=lcnine&cafe24MemberId=member-1',
    '/cafe24/internal/links?mallId=lcnine',
  ];

  it.each(paths)('키가 없거나 틀리면 %s 요청을 거부한다', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer wrong-key').expect(401);

    expect(service.getLinkInfoByCafe24MemberId).not.toHaveBeenCalled();
    expect(service.getAllLinksByMallId).not.toHaveBeenCalled();
  });

  it.each(paths)('서버 키가 설정되지 않으면 %s 요청을 거부한다', async (path) => {
    internalKey = undefined;

    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer test-key').expect(401);

    expect(service.getLinkInfoByCafe24MemberId).not.toHaveBeenCalled();
    expect(service.getAllLinksByMallId).not.toHaveBeenCalled();
  });

  it.each([
    [paths[0], linkInfo],
    [paths[1], links],
  ])('맞는 키로 %s 요청을 처리한다', async (path, expected) => {
    const response = await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer test-key').expect(200);

    expect(response.body).toMatchObject({ success: true, data: expected });
  });
});
