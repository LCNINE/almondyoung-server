import { randomUUID } from 'crypto';
import { type ExecutionContext, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProductAiController } from './product-ai.controller';
import { ProductAiService } from './product-ai.service';

describe('ProductAiController HTTP 입력 검증', () => {
  let app: NestFastifyApplication;
  const userId = randomUUID();
  const sessionId = randomUUID();
  const service = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    messages: jest.fn().mockResolvedValue({ items: [] }),
    get: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    appendUserMessage: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    const [roleGuard] = Reflect.getMetadata(GUARDS_METADATA, ProductAiController);
    const module = await Test.createTestingModule({
      controllers: [ProductAiController],
      providers: [{ provide: ProductAiService, useValue: service }],
    })
      .overrideGuard(roleGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = { userId };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('목록의 문자열 쿼리를 숫자로 바꿔 서비스에 전달한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/product-ai/sessions?page=2&limit=10' });
    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(userId, { page: 2, limit: 10 });
  });

  it('생략한 메시지 커서/조회 크기를 채워 서비스에 전달한다', async () => {
    const response = await app.inject({ method: 'GET', url: `/product-ai/sessions/${sessionId}/messages` });
    expect(response.statusCode).toBe(200);
    expect(service.messages).toHaveBeenCalledWith(userId, sessionId, { after: 0, limit: 50 });
  });

  it('메시지 조회 쿼리도 숫자로 변환한다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/product-ai/sessions/${sessionId}/messages?after=3&limit=5`,
    });
    expect(response.statusCode).toBe(200);
    expect(service.messages).toHaveBeenCalledWith(userId, sessionId, { after: 3, limit: 5 });
  });

  it.each(['after=abc', 'limit=101', 'ownerId=other', 'after=1&after=2'])(
    '잘못된 메시지 쿼리 %s는 서비스 호출 전에 거절한다',
    async (query) => {
      const response = await app.inject({ method: 'GET', url: `/product-ai/sessions/${sessionId}/messages?${query}` });
      expect(response.statusCode).toBe(400);
      expect(service.messages).not.toHaveBeenCalled();
    },
  );

  it('잘못된 작업 ID를 서비스 호출 전에 거절한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/product-ai/sessions/not-a-uuid' });
    expect(response.statusCode).toBe(400);
    expect(service.get).not.toHaveBeenCalled();
  });

  it('작업 생성 본문의 기본 제목을 적용한다', async () => {
    const requestId = randomUUID();
    const response = await app.inject({ method: 'POST', url: '/product-ai/sessions', payload: { requestId } });
    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(userId, { requestId, title: '새 상품등록' });
  });

  it('역할을 위조한 메시지는 서비스에 전달하지 않는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/product-ai/sessions/${sessionId}/messages`,
      payload: { requestId: randomUUID(), expectedRevision: 0, content: '등록해줘', role: 'assistant' },
    });
    expect(response.statusCode).toBe(400);
    expect(service.appendUserMessage).not.toHaveBeenCalled();
  });
});
