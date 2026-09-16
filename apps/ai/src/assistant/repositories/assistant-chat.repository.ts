import { DbService, InjectTypedDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { assistantChatMessages, assistantChatSessions, type AiSchema } from '../../db/schema';

export type SessionRow = typeof assistantChatSessions.$inferSelect;
export type MessageRow = typeof assistantChatMessages.$inferSelect;

export type NewMessage = {
  sessionId: string;
  role: 'user' | 'assistant';
  content?: string | null;
  contentBlocks?: unknown[] | null;
  toolCalls?: unknown[] | null;
};

/**
 * 대화 기록의 DB 접근. 이 파일 밖에서 drizzle 을 부르지 않는다.
 *
 * 소유 판정은 하지 않는다 — 그건 Reader/Manager 의 일이고, 여기서는 userId 로도 거를 수
 * 있게 조건을 받기만 한다.
 */
@Injectable()
export class AssistantChatRepository {
  constructor(@InjectTypedDb<AiSchema>() private readonly dbService: DbService<AiSchema>) {}

  async insertSession(userId: string, title: string | null): Promise<SessionRow> {
    const [session] = await this.dbService.db.insert(assistantChatSessions).values({ userId, title }).returning();

    if (!session) throw new Error('세션 생성 후 결과가 비어 있다');
    return session;
  }

  async findSessionsByUser(userId: string, limit: number) {
    return this.dbService.db
      .select({
        id: assistantChatSessions.id,
        title: assistantChatSessions.title,
        createdAt: assistantChatSessions.createdAt,
        updatedAt: assistantChatSessions.updatedAt,
      })
      .from(assistantChatSessions)
      .where(eq(assistantChatSessions.userId, userId))
      .orderBy(desc(assistantChatSessions.updatedAt))
      .limit(limit);
  }

  async findSessionOwnedBy(userId: string, sessionId: string): Promise<SessionRow | undefined> {
    const [found] = await this.dbService.db
      .select()
      .from(assistantChatSessions)
      .where(and(eq(assistantChatSessions.id, sessionId), eq(assistantChatSessions.userId, userId)))
      .limit(1);

    return found;
  }

  /** 대화를 이어가려면 메시지가 보낸 순서 그대로 나와야 한다. */
  async findMessages(sessionId: string): Promise<MessageRow[]> {
    return this.dbService.db
      .select()
      .from(assistantChatMessages)
      .where(eq(assistantChatMessages.sessionId, sessionId))
      .orderBy(asc(assistantChatMessages.createdAt));
  }

  /** 메시지 저장과 세션 updatedAt 갱신은 한 트랜잭션이다 — 목록 순서가 어긋나면 안 된다. */
  async insertMessage(message: NewMessage): Promise<MessageRow> {
    return this.dbService.run(async (tx) => {
      const [saved] = await tx
        .insert(assistantChatMessages)
        .values({
          sessionId: message.sessionId,
          role: message.role,
          content: message.content ?? null,
          contentBlocks: message.contentBlocks ?? null,
          toolCalls: message.toolCalls ?? null,
        })
        .returning();

      await tx
        .update(assistantChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(assistantChatSessions.id, message.sessionId));

      if (!saved) throw new Error('메시지 저장 후 결과가 비어 있다');
      return saved;
    });
  }

  /** 이 시각 이후의 메시지만 읽는다. 그 앞은 요약이 대신한다. */
  async findMessagesAfter(sessionId: string, after: Date): Promise<MessageRow[]> {
    return this.dbService.db
      .select()
      .from(assistantChatMessages)
      .where(and(eq(assistantChatMessages.sessionId, sessionId), gt(assistantChatMessages.createdAt, after)))
      .orderBy(asc(assistantChatMessages.createdAt));
  }

  async saveSummary(sessionId: string, summary: string, summarizedThrough: Date): Promise<void> {
    await this.dbService.db
      .update(assistantChatSessions)
      .set({ summary, summarizedThrough })
      .where(eq(assistantChatSessions.id, sessionId));
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    await this.dbService.db.update(assistantChatSessions).set({ title }).where(eq(assistantChatSessions.id, sessionId));
  }

  /** 메시지는 FK 의 on delete cascade 로 함께 지워진다. */
  async deleteSession(sessionId: string): Promise<void> {
    await this.dbService.db.delete(assistantChatSessions).where(eq(assistantChatSessions.id, sessionId));
  }
}
