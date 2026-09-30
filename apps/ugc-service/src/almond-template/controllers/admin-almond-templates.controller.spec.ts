import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { GlobalExceptionFilter, NotFoundError } from '@app/shared';
import { AlmondTemplatesService } from '../services/almond-templates.service';
import { AdminAlmondTemplatesController } from './admin-almond-templates.controller';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

describe('관리자 아몬드템플릿 썸네일 응답', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAlmondTemplatesController],
      providers: [
        {
          provide: AlmondTemplatesService,
          useValue: {
            getThumbnailForAdmin: (id: string) =>
              id === DRAFT
                ? Promise.resolve(SVG)
                : Promise.reject(new NotFoundError(`Almond template not found: ${id}`)),
          },
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

  it('초안도 격리 헤더와 함께 내려주고 캐시하지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: `/admin/almond-templates/${DRAFT}/thumbnail.svg` });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(SVG);
    expect(res.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('없으면 JSON 404 다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/almond-templates/22222222-2222-4222-8222-222222222222/thumbnail.svg',
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
