import { ProductAiImageService, type ProductAiFileAuth } from './product-ai-image.service';
import { PRODUCT_AI_IMAGES_PER_SESSION, PRODUCT_AI_IMAGES_TOTAL_BYTES } from '@packages/product-ai/images';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { isNull, and, asc, desc, eq, gt } from 'drizzle-orm';
import { type PimSchema, productAiMessages, productAiSessions } from '../../../schema/catalog.schema';
import type {
  AppendProductAiMessageInput,
  CreateProductAiSessionInput,
  ListProductAiSessionsQuery,
  ListProductAiMessagesQuery,
} from '../dto/product-ai.schema';

@Injectable()
export class ProductAiService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly images: ProductAiImageService,
  ) {}

  async create(ownerId: string, data: CreateProductAiSessionInput) {
    return this.db.run(async (tx) => {
      const [created] = await tx
        .insert(productAiSessions)
        .values({ ...data, ownerId })
        .onConflictDoNothing({ target: [productAiSessions.ownerId, productAiSessions.requestId] })
        .returning();
      if (created) return created;
      const [existing] = await tx
        .select()
        .from(productAiSessions)
        .where(and(eq(productAiSessions.ownerId, ownerId), eq(productAiSessions.requestId, data.requestId)));
      if (existing.deletedAt) throw new NotFoundException('삭제된 대화입니다. 새 대화를 시작해 주세요.');
      if (existing.title !== data.title) {
        throw new ConflictException('같은 요청 ID로 다른 작업을 생성할 수 없습니다.');
      }
      return existing;
    });
  }

  async rename(ownerId: string, sessionId: string, title: string) {
    const [session] = await this.db.db
      .update(productAiSessions)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(productAiSessions.id, sessionId),
          eq(productAiSessions.ownerId, ownerId),
          isNull(productAiSessions.deletedAt),
        ),
      )
      .returning();
    if (!session) throw new NotFoundException('대화를 찾을 수 없습니다.');
    return session;
  }

  async remove(ownerId: string, sessionId: string) {
    const [session] = await this.db.db
      .update(productAiSessions)
      .set({ deletedAt: new Date(), replyStatus: 'idle', replyLeaseId: null, replyLeaseUntil: null, replyError: null })
      .where(and(eq(productAiSessions.id, sessionId), eq(productAiSessions.ownerId, ownerId)))
      .returning({ id: productAiSessions.id });
    if (!session) throw new NotFoundException('대화를 찾을 수 없습니다.');
  }

  async list(ownerId: string, query: ListProductAiSessionsQuery) {
    const { page, limit } = query;
    const rows = await this.db.db
      .select()
      .from(productAiSessions)
      .where(and(eq(productAiSessions.ownerId, ownerId), isNull(productAiSessions.deletedAt)))
      .orderBy(desc(productAiSessions.updatedAt), desc(productAiSessions.id))
      .offset((page - 1) * limit)
      .limit(limit + 1);
    return { items: rows.slice(0, limit), page, hasMore: rows.length > limit };
  }

  async get(ownerId: string, sessionId: string) {
    const [session] = await this.db.db
      .select()
      .from(productAiSessions)
      .where(
        and(
          eq(productAiSessions.id, sessionId),
          eq(productAiSessions.ownerId, ownerId),
          isNull(productAiSessions.deletedAt),
        ),
      );
    if (!session) throw new NotFoundException('상품등록 작업을 찾을 수 없습니다.');
    return session;
  }

  async messages(ownerId: string, sessionId: string, query: ListProductAiMessagesQuery) {
    const { after, limit } = query;
    await this.get(ownerId, sessionId);
    const rows = await this.db.db
      .select()
      .from(productAiMessages)
      .where(and(eq(productAiMessages.sessionId, sessionId), gt(productAiMessages.sequence, after)))
      .orderBy(asc(productAiMessages.sequence))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextAfter: items.at(-1)?.sequence ?? after, hasMore: rows.length > limit };
  }

  async feedback(ownerId: string, sessionId: string, messageId: string, rating: 'up' | 'down' | null) {
    await this.get(ownerId, sessionId);
    const [updated] = await this.db.db
      .update(productAiMessages)
      .set({ feedback: rating })
      .where(
        and(
          eq(productAiMessages.id, messageId),
          eq(productAiMessages.sessionId, sessionId),
          eq(productAiMessages.role, 'assistant'),
        ),
      )
      .returning({ id: productAiMessages.id, feedback: productAiMessages.feedback });
    if (!updated) throw new NotFoundException('답변을 찾을 수 없습니다.');
    return updated;
  }

  async appendUserMessage(
    ownerId: string,
    sessionId: string,
    data: AppendProductAiMessageInput,
    auth: ProductAiFileAuth = {},
  ) {
    await this.get(ownerId, sessionId);
    const attachments = await this.images.inspect(data.imageIds ?? [], auth);
    return this.db.run(async (tx) => {
      // 한 작업의 입력을 직렬화한다. 모델 호출은 이 트랜잭션 안에서 실행하지 않는다.
      const [session] = await tx
        .select()
        .from(productAiSessions)
        .where(
          and(
            eq(productAiSessions.id, sessionId),
            eq(productAiSessions.ownerId, ownerId),
            isNull(productAiSessions.deletedAt),
          ),
        )
        .for('update');
      if (!session) throw new NotFoundException('상품등록 작업을 찾을 수 없습니다.');

      const [existing] = await tx
        .select()
        .from(productAiMessages)
        .where(and(eq(productAiMessages.sessionId, sessionId), eq(productAiMessages.requestId, data.requestId)));
      // 응답을 잃은 요청의 재시도는 revision 검사보다 먼저 처리한다.
      if (existing) {
        if (
          existing.role !== 'user' ||
          existing.content !== data.content ||
          JSON.stringify(existing.attachments.map((file) => file.fileId)) !== JSON.stringify(data.imageIds ?? [])
        ) {
          throw new ConflictException('같은 요청 ID로 다른 메시지를 저장할 수 없습니다.');
        }
        return { message: existing, revision: session.revision };
      }
      if (session.replyStatus === 'pending' || session.replyStatus === 'running') {
        throw new ConflictException('이전 메시지의 AI 답변을 먼저 확인해 주세요.');
      }
      if (session.revision !== data.expectedRevision) {
        throw new ConflictException('다른 입력이 먼저 저장되었습니다. 대화를 새로 불러온 뒤 다시 보내주세요.');
      }

      if (attachments.length) {
        const previous = await tx
          .select({ attachments: productAiMessages.attachments })
          .from(productAiMessages)
          .where(eq(productAiMessages.sessionId, sessionId));
        const all = previous.flatMap((row) => row.attachments).concat(attachments);
        if (
          all.length > PRODUCT_AI_IMAGES_PER_SESSION ||
          all.reduce((sum, file) => sum + file.size, 0) > PRODUCT_AI_IMAGES_TOTAL_BYTES
        ) {
          throw new BadRequestException(
            '대화당 이미지 12장·합계 20MB까지 첨부할 수 있습니다. 새 대화를 시작해 주세요.',
          );
        }
      }
      const revision = session.revision + 1;
      const [message] = await tx
        .insert(productAiMessages)
        .values({
          sessionId,
          requestId: data.requestId,
          sequence: revision,
          role: 'user',
          attachments,
          content: data.content,
        })
        .returning();
      await tx
        .update(productAiSessions)
        .set({
          revision,
          updatedAt: new Date(),
          replyStatus: 'pending',
          lastUserMessageId: message.id,
          replyError: null,
        })
        .where(eq(productAiSessions.id, sessionId));
      return { message, revision };
    });
  }
}
