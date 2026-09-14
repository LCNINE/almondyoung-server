import { randomUUID } from 'crypto';
import { type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createGlobalValidationPipe } from '../../../../../platform/http/validation-pipe';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ProductAiController } from './product-ai.controller';
import { ProductAiService } from '../services/product-ai.service';
import { ProductAiReplyService } from '../services/product-ai.reply.service';

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
    feedback: jest.fn().mockResolvedValue({}),
  };
  const replies = { respond: jest.fn(), cancel: jest.fn().mockResolvedValue({ status: 'failed' }) };

  beforeAll(async () => {
    const [roleGuard] = Reflect.getMetadata(GUARDS_METADATA, ProductAiController);
    const module = await Test.createTestingModule({
      controllers: [ProductAiController],
      providers: [
        { provide: ProductAiService, useValue: service },
        { provide: ProductAiReplyService, useValue: replies },
      ],
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
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('스트림을 완료할 때까지 delta를 보내고 저장 처리 반환 뒤 done을 보낸다', async () => {
    const messageId = randomUUID();
    replies.respond.mockImplementationOnce(async (_owner, _id, _message, options) => {
      options.onDelta('실시간 답변');
      return { status: 'idle' };
    });
    const response = await app.inject({
      method: 'POST',
      url: `/product-ai/sessions/${sessionId}/respond-stream`,
      payload: { messageId },
    });
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"type":"delta","text":"실시간 답변"');
    expect(response.body.indexOf('"type":"done"')).toBeGreaterThan(response.body.indexOf('"type":"delta"'));
  });

  it('feedback 입력에 타인 소유권이나 임의 rating을 넣을 수 없다', async () => {
    for (const payload of [{ rating: 'up', ownerId: randomUUID() }, { rating: 'unknown' }]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/product-ai/sessions/${sessionId}/messages/${randomUUID()}/feedback`,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.feedback).not.toHaveBeenCalled();
  });

  it('Swagger 쿼리와 요청 본문을 Zod DTO에서 생성한다', () => {
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, new DocumentBuilder().build()));
    const operation = document.paths['/product-ai/sessions/{id}/messages'].get!;
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
        expect.objectContaining({
          name: 'after',
          in: 'query',
          required: false,
          schema: expect.objectContaining({ default: 0, minimum: 0 }),
        }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
          schema: expect.objectContaining({ default: 50, minimum: 1, maximum: 100 }),
        }),
      ]),
    );
    expect(document.components?.schemas?.CreateProductAiSessionDto).toEqual(
      expect.objectContaining({
        required: ['requestId'],
        properties: expect.objectContaining({
          requestId: expect.objectContaining({ type: 'string', format: 'uuid' }),
          title: expect.objectContaining({ default: '새 상품등록', maxLength: 200 }),
        }),
      }),
    );
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
