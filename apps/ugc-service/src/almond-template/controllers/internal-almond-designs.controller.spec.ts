import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { verify } from 'jsonwebtoken';
import { GlobalExceptionFilter, NotFoundError } from '@app/shared';
import { OutboundTenant, outboundTenantForTesting } from '@app/tenancy';
import { AlmondDesignsService } from '../services/almond-designs.service';
import { InternalAlmondDesignsController } from './internal-almond-designs.controller';

const ID = '11111111-1111-4111-8111-111111111111';
const MISSING = '22222222-2222-4222-8222-222222222222';
const KEY = 'internal-key';
const SECRET = 'auth-secret';
const AUTH = { authorization: `Bearer ${KEY}` };

describe('InternalAlmondDesignsController', () => {
  let app: NestFastifyApplication;
  const printLink = jest.fn();
  const getInfo = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalAlmondDesignsController],
      providers: [
        { provide: AlmondDesignsService, useValue: { printLink, getInfo } },
        { provide: OutboundTenant, useValue: outboundTenantForTesting() },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => ({ UGC_INTERNAL_KEY: KEY, AUTH_SECRET: SECRET })[k] },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    printLink.mockReset();
    getInfo.mockReset();
  });

  it('키가 없으면 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/internal/almond-designs/${ID}` });
    expect(res.statusCode).toBe(401);
    expect(getInfo).not.toHaveBeenCalled();
  });

  it('시안 정보를 돌려준다', async () => {
    const info = { id: ID, productId: 'prod_1', widthMm: 90, heightMm: 50, hasBack: true };
    getInfo.mockResolvedValue(info);
    const res = await app.inject({ method: 'GET', url: `/internal/almond-designs/${ID}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(info);
  });

  it('없는 id 는 404', async () => {
    getInfo.mockRejectedValue(new NotFoundError(`Almond design not found: ${MISSING}`));
    const res = await app.inject({ method: 'GET', url: `/internal/almond-designs/${MISSING}`, headers: AUTH });
    expect(res.statusCode).toBe(404);
  });

  it('print-link 는 format·dpi 와 서비스 토큰으로 printLink 를 부른다', async () => {
    const link = { url: 'https://s3/x', expiresAt: '2026-10-14T00:00:00.000Z', fileName: 'a.jpg' };
    printLink.mockResolvedValue(link);
    const res = await app.inject({
      method: 'GET',
      url: `/internal/almond-designs/${ID}/print-link?format=jpg&dpi=300`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(link);
    const [id, format, dpi, token] = printLink.mock.calls[0];
    expect([id, format, dpi]).toEqual([ID, 'jpg', 300]);
    const claims = verify(token, SECRET, { algorithms: ['HS256'] });
    expect(claims).toMatchObject({ client_id: 'ugc-service', aud: 'file-service' });
    const { exp, iat } = claims as { exp: number; iat: number };
    expect(exp - iat).toBe(300);
  });

  it('print-link 키가 없으면 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/internal/almond-designs/${ID}/print-link?format=jpg` });
    expect(res.statusCode).toBe(401);
    expect(printLink).not.toHaveBeenCalled();
  });

  it('형식이 틀리거나 dpi 가 범위 밖이면 400', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: `/internal/almond-designs/${ID}/print-link?format=png`,
      headers: AUTH,
    });
    expect(bad.statusCode).toBe(400);
    const dpi = await app.inject({
      method: 'GET',
      url: `/internal/almond-designs/${ID}/print-link?format=jpg&dpi=1`,
      headers: AUTH,
    });
    expect(dpi.statusCode).toBe(400);
    expect(printLink).not.toHaveBeenCalled();
  });
});
