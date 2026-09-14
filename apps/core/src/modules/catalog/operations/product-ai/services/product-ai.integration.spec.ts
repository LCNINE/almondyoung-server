import { ProductAiImageService } from './product-ai-image.service';
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
import { ProductAiDraftService } from './product-ai-draft.service';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { ProductAiSalesService } from './product-ai-sales.service';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import type { ProductAiDraft } from '@packages/product-ai/draft';

const referenceId = '550e8400-e29b-41d4-a716-446655440000';
const completeSales = {
  marketPrice: 5000,
  supplyPrice: 1000,
  salePrice: 3000,
  membershipPrice: 2500,
  membershipPricing: 'custom' as const,
  options: [],
  categories: [{ id: referenceId, name: '스티커', parentId: null }],
  primaryCategoryIndex: 0,
  tagValueIds: [],
  inventory: [
    { optionValues: [], skuId: referenceId, newSkuName: null, quantity: 1, salePrice: null, membershipPrice: null },
  ],
};

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
  const sales = {
    canCreateSku: jest.fn().mockResolvedValue(false),
    lookup: jest.fn().mockResolvedValue([]),
    validate: jest.fn(),
    apply: jest.fn(),
  };
  const drafts = { save: jest.fn().mockResolvedValue({ status: 'active' }) };
  const provider = { reply: jest.fn().mockResolvedValue('판매가는 얼마인가요?') };
  beforeEach(() => {
    drafts.save.mockClear();
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
      await migrationClient.unsafe(
        readFileSync(join(process.cwd(), 'apps/core/drizzle/20260914053345_product-ai-feedback-sources.sql'), 'utf8'),
      );
      await migrationClient.unsafe(
        readFileSync(join(process.cwd(), 'apps/core/drizzle/20260914054932_product-ai-soft-delete.sql'), 'utf8'),
      );
      await migrationClient.unsafe(
        readFileSync(join(process.cwd(), 'apps/core/drizzle/20260914065657_product-ai-image-attachments.sql'), 'utf8'),
      );
      await migrationClient.unsafe(
        readFileSync(join(process.cwd(), 'apps/core/drizzle/20260914073828_product-ai-draft-preview.sql'), 'utf8'),
      );
    } finally {
      await migrationClient.end();
    }
    db = new DbService({ connectionString }, catalogSchema);
    service = new ProductAiService(db, new ProductAiImageService());
    replies = new ProductAiReplyService(
      db,
      provider,
      new ProductAiImageService(),
      sales as unknown as ProductAiSalesService,
      drafts as unknown as ProductAiDraftService,
    );
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

  const draft: ProductAiDraft = {
    name: '냥이 스티커',
    description: '고양이 스티커',
    seoTitle: '냥이 스티커',
    seoDescription: '고양이 그림 스티커',
    seoKeywords: ['스티커'],
    tags: [],
    thumbnailFileId: null,
    additionalImageFileIds: [],
    sections: [{ kind: 'text', heading: '소개', body: '<script>alert(1)</script>' }],
    pendingItems: ['가격 미정'],
  };
  async function prepareDraft() {
    const session = await createSession();
    const { message } = await service.appendUserMessage(owner, session.id, input('상세페이지 초안 만들어줘'));
    provider.reply.mockImplementationOnce(async (_history, options) => {
      options.onDraft(draft);
      return '미리보기 준비';
    });
    await replies.respond(owner, session.id, message.id);
    const history = await service.messages(owner, session.id, { after: 0, limit: 100 });
    return { session, message: history.items.at(-1)! };
  }
  function draftSaver() {
    const version = { id: randomUUID(), masterId: randomUUID(), status: 'draft', draftOwnerId: owner };
    const masters = {
      createMaster: jest.fn().mockResolvedValue(version),
      updateVersion: jest.fn().mockResolvedValue(version),
      getVersionById: jest.fn().mockResolvedValue(version),
    };
    const images = new ProductAiImageService();
    const copies = jest.spyOn(images, 'copyForProduct').mockResolvedValue(new Map());
    return {
      service: new ProductAiDraftService(
        db,
        masters as unknown as ProductMastersService,
        images,
        sales as unknown as ProductAiSalesService,
        { publishVersion: jest.fn() } as unknown as ProductVersionsService,
      ),
      masters,
      copies,
    };
  }
  it('직접 등록 요청만 발행하며 재시도는 다시 발행하지 않는다', async () => {
    const session = await createSession();
    const { message } = await service.appendUserMessage(owner, session.id, input('등록해줘'));
    const imageId = randomUUID();
    // Seed a validated attachment without accessing the external file service.
    const { productAiMessages } = await import('../../../schema/catalog.schema');
    await db.db
      .update(productAiMessages)
      .set({ attachments: [{ fileId: imageId, fileName: 'test.png', mimeType: 'image/png', size: 1 }] })
      .where(eq(productAiMessages.id, message.id));
    const imageSpy = jest
      .spyOn(ProductAiImageService.prototype, 'load')
      .mockResolvedValue(new Map([[imageId, 'data:image/png;base64,eA==']]));
    provider.reply.mockImplementationOnce(async (_history, options) => {
      options.onDraft({ ...draft, thumbnailFileId: imageId, sales: completeSales, pendingItems: [] });
      return '미리보기';
    });
    try {
      await replies.respond(owner, session.id, message.id, { roles: ['master'] });
      expect(drafts.save).toHaveBeenCalledTimes(1);
      expect((drafts.save.mock.calls[0] as unknown[])[4]).toMatchObject({ publish: true, roles: ['master'] });
      await replies.respond(owner, session.id, message.id);
      expect(drafts.save).toHaveBeenCalledTimes(1);
      expect((await service.messages(owner, session.id, { after: 0, limit: 100 })).items.at(-1)?.content).toContain(
        '발행을 완료',
      );
    } finally {
      imageSpy.mockRestore();
    }
  });
  it('발행 처리 실패나 중지 시 성공 답변을 커밋하지 않는다', async () => {
    const session = await createSession();
    const { message } = await service.appendUserMessage(owner, session.id, input('등록해줘'));
    const imageId = randomUUID();
    const { productAiMessages } = await import('../../../schema/catalog.schema');
    await db.db
      .update(productAiMessages)
      .set({ attachments: [{ fileId: imageId, fileName: 'test.png', mimeType: 'image/png', size: 1 }] })
      .where(eq(productAiMessages.id, message.id));
    const imageSpy = jest
      .spyOn(ProductAiImageService.prototype, 'load')
      .mockResolvedValue(new Map([[imageId, 'data:image/png;base64,eA==']]));
    const abort = new AbortController();
    provider.reply.mockImplementationOnce(async (_history, options) => {
      options.onDraft({ ...draft, thumbnailFileId: imageId, sales: completeSales, pendingItems: [] });
      return '미리보기';
    });
    drafts.save.mockImplementationOnce(async () => {
      abort.abort();
      return { status: 'active' };
    });
    try {
      await expect(replies.respond(owner, session.id, message.id, { signal: abort.signal })).rejects.toThrow();
      expect((await service.messages(owner, session.id, { after: 0, limit: 100 })).items).toHaveLength(1);
      expect((await service.get(owner, session.id)).replyStatus).toBe('failed');
    } finally {
      imageSpy.mockRestore();
    }
  });
  it('가격/재고가 미정인 등록 요청은 질문으로 남기고 발행하지 않는다', async () => {
    const session = await createSession();
    const { message } = await service.appendUserMessage(owner, session.id, input('등록해줘'));
    provider.reply.mockImplementationOnce(async (_history, options) => {
      options.onDraft(draft);
      return '준비';
    });
    await replies.respond(owner, session.id, message.id);
    expect(drafts.save).not.toHaveBeenCalled();
    expect((await service.messages(owner, session.id, { after: 0, limit: 100 })).items.at(-1)?.content).toContain(
      '등록 요청은 받았어요. 아직 발행되지 않았습니다.',
    );
  });
  it('등록 요청을 유지하며 카테고리 선택 다음에는 재고 연결을 안내한다', async () => {
    const session = await createSession();
    const first = await service.appendUserMessage(owner, session.id, input('등록해줘봐'));
    provider.reply.mockImplementationOnce(async (_history, options) => {
      options.onDraft({
        ...draft,
        sales: { ...completeSales, categories: [], primaryCategoryIndex: null, inventory: [] },
        pendingItems: ['카테고리', '재고'],
      });
      return '준비';
    });
    await replies.respond(owner, session.id, first.message.id);
    const firstAnswer = (await service.messages(owner, session.id, { after: 0, limit: 100 })).items.at(-1)!;
    expect(firstAnswer.content).toContain('어떤 카테고리로 등록할까요?');
    expect(firstAnswer.productDraft?.sales?.supplyPrice).toBe(1000);

    const second = await service.appendUserMessage(owner, session.id, input('스티커를 대표카테고리로 할게', 2));
    provider.reply.mockImplementationOnce(async (_history, options) => {
      expect(JSON.parse(options.draftContext).publishRequested).toBe(true);
      options.onDraft({ ...draft, sales: { ...completeSales, inventory: [] }, pendingItems: ['재고'] });
      return '준비';
    });
    await replies.respond(owner, session.id, second.message.id);
    const secondAnswer = (await service.messages(owner, session.id, { after: 0, limit: 100 })).items.at(-1)!;
    expect(secondAnswer.content).toContain('어떤 재고 품목에 연결할까요?');
    expect(secondAnswer.content).not.toContain('초안');
    expect(drafts.save).not.toHaveBeenCalled();
  });
  it('모델이 대화 밖의 이미지 ID를 만들면 미리보기를 저장하지 않는다', async () => {
    const session = await createSession();
    const { message } = await service.appendUserMessage(owner, session.id, input('미리보기 만들어줘'));
    provider.reply.mockImplementationOnce(async (_history, options) => {
      options.onDraft({ ...draft, thumbnailFileId: randomUUID() });
      return '미리보기';
    });
    await expect(replies.respond(owner, session.id, message.id)).rejects.toThrow('첨부 이미지');
    const history = await service.messages(owner, session.id, { after: 0, limit: 100 });
    expect(history.items).toHaveLength(1);
  });
  it('미리보기를 보존하고 동시 저장/응답 유실 재시도에도 상품은 한 번만 생성한다', async () => {
    const prepared = await prepareDraft();
    expect(prepared.message.productDraft).toEqual(draft);
    const saver = draftSaver();
    const results = await Promise.all([
      saver.service.save(owner, prepared.session.id, prepared.message.id, {}),
      saver.service.save(owner, prepared.session.id, prepared.message.id, {}),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(saver.masters.createMaster).toHaveBeenCalledTimes(1);
    expect(saver.masters.updateVersion.mock.calls[0][1].descriptionHtml).toContain('&lt;script&gt;');
    expect(saver.masters.updateVersion.mock.calls[0][1]).not.toHaveProperty('status');
  });
  it('타인이나 이전 대화 버전의 미리보기는 상품을 만들지 못한다', async () => {
    const prepared = await prepareDraft();
    const saver = draftSaver();
    await expect(saver.service.save(otherOwner, prepared.session.id, prepared.message.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.appendUserMessage(owner, prepared.session.id, input('내용 수정', 2));
    await expect(saver.service.save(owner, prepared.session.id, prepared.message.id, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(saver.masters.createMaster).not.toHaveBeenCalled();
    expect(saver.copies).not.toHaveBeenCalled();
  });
  it('상품 저장 실패 시 완료 표시를 남기지 않아 재시도할 수 있다', async () => {
    const prepared = await prepareDraft();
    const saver = draftSaver();
    saver.masters.updateVersion.mockRejectedValueOnce(new Error('write failed'));
    await expect(saver.service.save(owner, prepared.session.id, prepared.message.id, {})).rejects.toThrow(
      'write failed',
    );
    expect((await service.get(owner, prepared.session.id)).savedProduct).toBeNull();
  });

  it('첨부 ID를 저장하며 같은 요청의 다른 첨부로 재시도할 수 없다', async () => {
    const file = { fileId: randomUUID(), fileName: '상품.png', mimeType: 'image/png', size: 100 };
    const inspect = jest.spyOn(ProductAiImageService.prototype, 'inspect').mockResolvedValue([file]);
    try {
      const session = await createSession();
      const data = { ...input('사진을 읽어줘'), imageIds: [file.fileId] };
      const first = await service.appendUserMessage(owner, session.id, data);
      expect(first.message.attachments).toEqual([file]);
      expect((await service.appendUserMessage(owner, session.id, data)).message.id).toBe(first.message.id);
      await expect(service.appendUserMessage(owner, session.id, { ...data, imageIds: [randomUUID()] })).rejects.toThrow(
        ConflictException,
      );
      expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items[0].attachments).toEqual([file]);
    } finally {
      inspect.mockRestore();
    }
  });

  it('본인만 제목을 수정하고 소프트 삭제한 대화는 조회하거나 이어갈 수 없다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('안녕'));
    await expect(service.rename(otherOwner, session.id, '변경')).rejects.toThrow(NotFoundException);
    await expect(service.remove(otherOwner, session.id)).rejects.toThrow(NotFoundException);
    await service.rename(owner, session.id, '새 제목');
    expect((await service.get(owner, session.id)).title).toBe('새 제목');
    await service.remove(owner, session.id);
    await service.remove(owner, session.id);
    expect((await service.list(owner, { page: 1, limit: 100 })).items.some((row) => row.id === session.id)).toBe(false);
    await expect(service.get(owner, session.id)).rejects.toThrow(NotFoundException);
    await expect(service.messages(owner, session.id, { after: 0, limit: 50 })).rejects.toThrow(NotFoundException);
    await expect(service.rename(owner, session.id, '복구 시도')).rejects.toThrow(NotFoundException);
    await expect(service.appendUserMessage(owner, session.id, input('다시', 1))).rejects.toThrow(NotFoundException);
    await expect(replies.respond(owner, session.id, sent.message.id)).rejects.toThrow(NotFoundException);
    const [stored] = await db.db.select().from(productAiSessions).where(eq(productAiSessions.id, session.id));
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });

  it('답변 피드백과 사용한 가이드를 저장하고 타인/사용자 메시지 평가는 거절한다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('대표카테고리가 뭐예요?'));
    await replies.respond(owner, session.id, sent.message.id);
    const history = await service.messages(owner, session.id, { after: 0, limit: 50 });
    const answer = history.items.at(-1)!;
    expect(answer.sources[0].id).toBe('category-v1');
    await expect(service.feedback(otherOwner, session.id, answer.id, 'up')).rejects.toThrow(NotFoundException);
    await expect(service.feedback(owner, session.id, sent.message.id, 'up')).rejects.toThrow(NotFoundException);
    await service.feedback(owner, session.id, answer.id, 'up');
    expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items.at(-1)?.feedback).toBe('up');
    await service.feedback(owner, session.id, answer.id, null);
    expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items.at(-1)?.feedback).toBeNull();
  });

  it('생성 중지 후 늦은 답변을 저장하지 않고 새 메시지를 받을 수 있다', async () => {
    const session = await createSession();
    const sent = await service.appendUserMessage(owner, session.id, input('가격 안내'));
    let finish!: (text: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    provider.reply.mockImplementationOnce(() => {
      started();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const response = replies.respond(owner, session.id, sent.message.id).catch((error) => error);
    await ready;
    await expect(replies.cancel(otherOwner, session.id, sent.message.id)).rejects.toThrow(NotFoundException);
    await replies.cancel(owner, session.id, sent.message.id);
    finish('저장되면 안 되는 답변');
    expect(await response).toBeInstanceOf(ServiceUnavailableException);
    expect((await service.messages(owner, session.id, { after: 0, limit: 50 })).items).toHaveLength(1);
    await service.appendUserMessage(owner, session.id, input('다른 질문', 1));
  });

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
      const reopened = new ProductAiService(reopenedDb, new ProductAiImageService());
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
