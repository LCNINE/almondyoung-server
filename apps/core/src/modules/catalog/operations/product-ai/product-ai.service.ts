import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { type PimSchema, productAiMessages, productAiSessions } from '../../schema/catalog.schema';
import type {
  AppendProductAiMessageInput,
  CreateProductAiSessionInput,
  ListProductAiSessionsQuery,
  ListProductAiMessagesQuery,
} from './product-ai.schema';

@Injectable()
export class ProductAiService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

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
      if (existing.title !== data.title) {
        throw new ConflictException('같은 요청 ID로 다른 작업을 생성할 수 없습니다.');
      }
      return existing;
    });
  }

  async list(ownerId: string, query: ListProductAiSessionsQuery) {
    const { page, limit } = query;
    const rows = await this.db.db
      .select()
      .from(productAiSessions)
      .where(eq(productAiSessions.ownerId, ownerId))
      .orderBy(desc(productAiSessions.updatedAt), desc(productAiSessions.id))
      .offset((page - 1) * limit)
      .limit(limit + 1);
    return { items: rows.slice(0, limit), page, hasMore: rows.length > limit };
  }

  async get(ownerId: string, sessionId: string) {
    const [session] = await this.db.db
      .select()
      .from(productAiSessions)
      .where(and(eq(productAiSessions.id, sessionId), eq(productAiSessions.ownerId, ownerId)));
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

  async appendUserMessage(ownerId: string, sessionId: string, data: AppendProductAiMessageInput) {
    return this.db.run(async (tx) => {
      // 한 작업의 입력을 직렬화한다. 모델 호출은 이 트랜잭션 안에서 실행하지 않는다.
      const [session] = await tx
        .select()
        .from(productAiSessions)
        .where(and(eq(productAiSessions.id, sessionId), eq(productAiSessions.ownerId, ownerId)))
        .for('update');
      if (!session) throw new NotFoundException('상품등록 작업을 찾을 수 없습니다.');

      const [existing] = await tx
        .select()
        .from(productAiMessages)
        .where(and(eq(productAiMessages.sessionId, sessionId), eq(productAiMessages.requestId, data.requestId)));
      // 응답을 잃은 요청의 재시도는 revision 검사보다 먼저 처리한다.
      if (existing) {
        if (existing.role !== 'user' || existing.content !== data.content) {
          throw new ConflictException('같은 요청 ID로 다른 메시지를 저장할 수 없습니다.');
        }
        return { message: existing, revision: session.revision };
      }
      if (session.revision !== data.expectedRevision) {
        throw new ConflictException('다른 입력이 먼저 저장되었습니다. 대화를 새로 불러온 뒤 다시 보내주세요.');
      }

      const revision = session.revision + 1;
      const [message] = await tx
        .insert(productAiMessages)
        .values({
          sessionId,
          requestId: data.requestId,
          sequence: revision,
          role: 'user',
          content: data.content,
        })
        .returning();
      await tx
        .update(productAiSessions)
        .set({ revision, updatedAt: new Date() })
        .where(eq(productAiSessions.id, sessionId));
      return { message, revision };
    });
  }
}
