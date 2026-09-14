import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as postgres from 'postgres';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '@app/db';
import { catalogSchema, productAiSessions, type PimSchema } from '../../../schema/catalog.schema';
import { ProductAiService } from './product-ai.service';
import { ProductAiReplyService } from './product-ai.reply.service';
import { eq } from 'drizzle-orm';

// 기본 DATABASE_URL은 사용하지 않는다. 로컬 PostgreSQL에 매 실행 독립 DB를 만들고 제거한다.
const testUrl = process.env.PRODUCT_AI_TEST_DATABASE_URL;
const describeWithDb = testUrl ? describe : describe.skip;

describeWithDb('상품등록 대화 PostgreSQL 저장/복구', () => {
  jest.setTimeout(30_000);
  const owner = randomUUID();
  const otherOwner = randomUUID();
  const databaseName = `product_ai_test_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let db: DbService<PimSchema>;
  let service: ProductAiService;
  let replies: ProductAiReplyService;
  const provider = { reply: jest.fn().mockResolvedValue('판매가는 얼마인가요?') };
  beforeEach(() => {
    provider.reply.mockReset().mockResolvedValue('판매가는 얼마인가요?');
  });
  let connectionString: string;
  let createdDatabase = false;

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('PRODUCT_AI_TEST_DATABASE_URL must point to a local disposable PostgreSQL server');
    }
    admin = postgres(testUrl!, { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    url.pathname = `/${databaseName}`;
    connectionString = url.toString();
    const migrationClient = postgres(connectionString, { max: 1 });
    try {
      const migration = readFileSync(
        join(process.cwd(), 'apps/core/drizzle/20260914041600_add-product-ai-sessions.sql'),
        'utf8',
      );
      await migrationClient.unsafe(migration);
      await migrationClient.unsafe(
        readFileSync(join(process.cwd(), 'apps/core/drizzle/20260914043718_add-product-ai-replies.sql'), 'utf8'),
      );
    } finally {
      await migrationClient.end();
    }
    db = new DbService({ connectionString }, catalogSchema);
    service = new ProductAiService(db);
    replies = new ProductAiReplyService(db, provider);
  });

  afterAll(async () => {
    await db?.onModuleDestroy();
    if (createdDatabase) await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  });

  async function createSession() {
    return service.create(owner, { requestId: randomUUID(), title: '미곤 상품등록' });
  }
  const input = (content: string, expectedRevision = 0) => ({ requestId: randomUUID(), expectedRevision, content });

  it('동시 생성 재시도는 같은 작업을 돌려주고 다른 내용은 거절한다', async () => {
    const data = { requestId: randomUUID(), title: '동시 생성' };
    const [a, b] = await Promise.all([service.create(owner, data), service.create(owner, data)]);
    expect(a.id).toBe(b.id);
    await expect(service.create(owner, { ...data, title: '다른 작업' })).rejects.toThrow(ConflictException);
    const other = await service.create(otherOwner, data);
    expect(other.id).not.toBe(a.id);
  });

  it('타인 작업 조회·메시지 조회·쓰기를 모두 차단하고 목록에서도 제외한다', async () => {
    const session = await createSession();
    await expect(service.get(otherOwner, session.id)).rejects.toThrow(NotFoundException);
    await expect(service.messages(otherOwner, session.id, { after: 0, limit: 50 })).rejects.toThrow(NotFoundException);
    await expect(service.appendUserMessage(otherOwner, session.id, input('침입'))).rejects.toThrow(NotFoundException);
    const list = await service.list(otherOwner, { page: 1, limit: 20 });
    expect(list.items.every((item) => item.ownerId === otherOwner && item.id !== session.id)).toBe(true);
  });

  it('응답 유실 후 같은 메시지를 재전송해도 한 번만 저장된다', async () => {
    const session = await createSession();
    const data = input('이 상품 등록해줘');
    const [a, b] = await Promise.all([
      service.appendUserMessage(owner, session.id, data),
      service.appendUserMessage(owner, session.id, data),
    ]);
    expect(a.message.id).toBe(b.message.id);
    expect((await service.get(owner, session.id)).revision).toBe(1);
    expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items).toHaveLength(1);
    await expect(service.appendUserMessage(owner, session.id, { ...data, content: '다른 명령' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('같은 revision의 다른 동시 입력은 하나만 저장하고 다른 입력은 409로 돌려준다', async () => {
    const session = await createSession();
    const results = await Promise.allSettled([
      service.appendUserMessage(owner, session.id, input('판매가 10000원')),
      service.appendUserMessage(owner, session.id, input('판매가 20000원')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictException);
    expect((await service.get(owner, session.id)).revision).toBe(1);
    expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items).toHaveLength(1);
  });

  it('별도 서버 연결에서도 대화가 복구되고 순번 커서로 빠짐없이 조회된다', async () => {
    const session = await createSession();
    const firstMessage = await service.appendUserMessage(owner, session.id, input('상품등록해줘'));
    await replies.respond(owner, session.id, firstMessage.message.id);
    const secondMessage = await service.appendUserMessage(owner, session.id, input('회원가 9000원', 2));
    await replies.respond(owner, session.id, secondMessage.message.id);
    await service.appendUserMessage(owner, session.id, input('대표카테고리가 뭐야?', 4));
    const reopenedDb = new DbService({ connectionString }, catalogSchema);
    try {
      const reopened = new ProductAiService(reopenedDb);
      const first = await reopened.messages(owner, session.id, { after: 0, limit: 2 });
      expect(first.items.map((item) => item.sequence)).toEqual([1, 2]);
      expect(first.hasMore).toBe(true);
      const next = await reopened.messages(owner, session.id, { after: first.nextAfter, limit: 50 });
      expect(next.items.map((item) => item.content)).toEqual([
        '회원가 9000원',
        '판매가는 얼마인가요?',
        '대표카테고리가 뭐야?',
      ]);
      expect(next.hasMore).toBe(false);
      expect((await reopened.get(owner, session.id)).revision).toBe(5);
    } finally {
      await reopenedDb.onModuleDestroy();
    }
  });
  it('완료 응답 재요청은 모델을 다시 호출하거나 답변을 중복 저장하지 않는다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('안녕하세요'));
    await replies.respond(owner, session.id, sent.message.id);
    await replies.respond(owner, session.id, sent.message.id);
    expect(provider.reply).toHaveBeenCalledTimes(1);
    expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('타인과 다른 메시지에 대한 응답 요청은 모델 호출 전에 차단한다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('안녕하세요'));
    await expect(replies.respond(otherOwner, session.id, sent.message.id)).rejects.toThrow(NotFoundException);
    await expect(replies.respond(owner, session.id, randomUUID())).rejects.toThrow(ConflictException);
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('실패는 저장되고 재시도하면 기존 사용자 메시지에 답변을 이어 붙인다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('상품등록'));
    provider.reply.mockRejectedValueOnce(new Error('provider secret diagnostic'));
    await expect(replies.respond(owner, session.id, sent.message.id)).rejects.toThrow(ServiceUnavailableException);
    expect((await service.get(owner, session.id)).replyStatus).toBe('failed');
    expect((await service.get(owner, session.id)).replyError).not.toContain('secret');
    await replies.respond(owner, session.id, sent.message.id);
    expect((await service.get(owner, session.id)).replyStatus).toBe('idle');
    expect((await service.get(owner, session.id)).revision).toBe(2);
  });

  it('실행 중에는 새 입력과 중복 모델 호출을 차단한다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('상품등록'));
    let finish!: (text: string) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    provider.reply.mockImplementationOnce(() => {
      started();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const response = replies.respond(owner, session.id, sent.message.id);
    await startedPromise;
    try {
      expect(await replies.respond(owner, session.id, sent.message.id)).toEqual({ status: 'running' });
      await expect(service.appendUserMessage(owner, session.id, input('다른 지시', 1))).rejects.toThrow(
        ConflictException,
      );
      expect(provider.reply).toHaveBeenCalledTimes(1);
    } finally {
      finish('답변입니다');
      await response;
    }
  });

  it('서버 중단으로 만료된 실행은 재시도로 복구한다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('상품등록'));
    await db.db
      .update(productAiSessions)
      .set({ replyStatus: 'running', replyLeaseId: randomUUID(), replyLeaseUntil: new Date(0) })
      .where(eq(productAiSessions.id, session.id));
    await replies.respond(owner, session.id, sent.message.id);
    expect((await service.get(owner, session.id)).replyStatus).toBe('idle');
  });
});
