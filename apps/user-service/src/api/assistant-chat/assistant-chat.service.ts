import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import * as schema from 'apps/user-service/database/drizzle/schema';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, asc, desc, eq } from 'drizzle-orm';
import { AppendMessageDto, CreateSessionDto } from './dto/assistant-chat.dto';

/**
 * 어드민 AI 어시스턴트의 대화 기록.
 *
 * 세션과 메시지는 언제나 그 사용자의 것만 다룬다 — 남의 대화가 보이면
 * 상품 가격·매입가 같은 내부 정보가 그대로 새어 나간다.
 */
@Injectable()
export class AssistantChatService {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async createSession(userId: string, dto: CreateSessionDto) {
    const [session] = await this.dbService.db
      .insert(schema.assistantChatSessions)
      .values({ userId, title: dto.title ?? null })
      .returning();

    return session;
  }

  async listSessions(userId: string, limit: number) {
    return this.dbService.db
      .select({
        id: schema.assistantChatSessions.id,
        title: schema.assistantChatSessions.title,
        createdAt: schema.assistantChatSessions.createdAt,
        updatedAt: schema.assistantChatSessions.updatedAt,
      })
      .from(schema.assistantChatSessions)
      .where(eq(schema.assistantChatSessions.userId, userId))
      .orderBy(desc(schema.assistantChatSessions.updatedAt))
      .limit(limit);
  }

  /** 대화를 이어가려면 메시지가 보낸 순서 그대로 나와야 한다. */
  async getMessages(userId: string, sessionId: string) {
    await this.mustOwn(userId, sessionId);

    return this.dbService.db
      .select()
      .from(schema.assistantChatMessages)
      .where(eq(schema.assistantChatMessages.sessionId, sessionId))
      .orderBy(asc(schema.assistantChatMessages.createdAt));
  }

  async appendMessage(userId: string, sessionId: string, dto: AppendMessageDto) {
    await this.mustOwn(userId, sessionId);

    return this.dbService.run(async (tx) => {
      const [message] = await tx
        .insert(schema.assistantChatMessages)
        .values({
          sessionId,
          role: dto.role,
          content: dto.content ?? null,
          contentBlocks: dto.contentBlocks ?? null,
          toolCalls: dto.toolCalls ?? null,
        })
        .returning();

      // 목록을 최근 대화 순으로 보여주려면 세션도 같이 올라와야 한다.
      await tx
        .update(schema.assistantChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.assistantChatSessions.id, sessionId));

      return message;
    });
  }

  async deleteSession(userId: string, sessionId: string) {
    await this.mustOwn(userId, sessionId);

    // 메시지는 FK 의 on delete cascade 로 함께 지워진다.
    await this.dbService.db.delete(schema.assistantChatSessions).where(eq(schema.assistantChatSessions.id, sessionId));

    return { deleted: true };
  }

  /** 내 세션이 아니면 없는 것으로 답한다 — 남의 세션 존재 여부도 알려주지 않는다. */
  private async mustOwn(userId: string, sessionId: string) {
    const [found] = await this.dbService.db
      .select({ id: schema.assistantChatSessions.id })
      .from(schema.assistantChatSessions)
      .where(and(eq(schema.assistantChatSessions.id, sessionId), eq(schema.assistantChatSessions.userId, userId)))
      .limit(1);

    if (!found) throw new NotFoundError(`대화를 찾을 수 없습니다: ${sessionId}`);
    return found;
  }
}
