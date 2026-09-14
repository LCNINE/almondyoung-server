import { randomUUID } from 'crypto';
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { isNull, and, asc, eq } from 'drizzle-orm';
import { type PimSchema, productAiMessages, productAiSessions } from '../../../schema/catalog.schema';
import { ProductAiProvider } from '../providers/product-ai.provider';
import { selectProductAiGuides } from '@packages/product-ai/guides';
import type { ProductAiReplyOptions } from '../providers/product-ai.provider';

@Injectable()
export class ProductAiReplyService {
  private readonly running = new Map<string, AbortController>();
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly provider: ProductAiProvider,
  ) {}

  async cancel(ownerId: string, sessionId: string, messageId: string) {
    const result = await this.db.run(async (tx) => {
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
      if (session.lastUserMessageId !== messageId) throw new ConflictException('최신 메시지가 아닙니다.');
      if (session.replyStatus === 'idle') return { status: 'idle' as const, leaseId: null };
      await tx
        .update(productAiSessions)
        .set({
          replyStatus: 'failed',
          replyLeaseId: null,
          replyLeaseUntil: null,
          replyError: '답변 생성을 중지했습니다. 다시 생성하거나 새 메시지를 보내세요.',
        })
        .where(eq(productAiSessions.id, sessionId));
      return { status: 'failed' as const, leaseId: session.replyLeaseId };
    });
    if (result.leaseId) this.running.get(result.leaseId)?.abort();
    return { status: result.status };
  }

  async respond(ownerId: string, sessionId: string, messageId: string, options: ProductAiReplyOptions = {}) {
    const leaseId = randomUUID();
    const claim = await this.db.run(async (tx) => {
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
      if (session.lastUserMessageId !== messageId) throw new ConflictException('최신 사용자 메시지를 확인해 주세요.');
      if (session.replyStatus === 'idle') return { acquired: false, status: 'idle' as const };
      if (session.replyStatus === 'running' && session.replyLeaseUntil && session.replyLeaseUntil > new Date()) {
        return { acquired: false, status: 'running' as const };
      }
      await tx
        .update(productAiSessions)
        .set({
          replyStatus: 'running',
          replyLeaseId: leaseId,
          replyLeaseUntil: new Date(Date.now() + 60_000),
          replyError: null,
        })
        .where(eq(productAiSessions.id, sessionId));
      return { acquired: true, status: 'running' as const };
    });
    if (!claim.acquired) return { status: claim.status };

    const abort = new AbortController();
    this.running.set(leaseId, abort);
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    try {
      // 이력을 조용히 잘라 이전 지시를 잊지 않는다. 요약/압축은 도구 연결 단계에서 추가한다.
      const history = await this.db.db
        .select({ role: productAiMessages.role, content: productAiMessages.content })
        .from(productAiMessages)
        .where(eq(productAiMessages.sessionId, sessionId))
        .orderBy(asc(productAiMessages.sequence))
        .limit(201);
      if (history.length > 200 || history.reduce((size, message) => size + message.content.length, 0) > 100_000) {
        throw new ServiceUnavailableException('대화가 길어졌습니다. 새 대화에서 상품 정보를 정리해 주세요.');
      }
      const sources = selectProductAiGuides(history.at(-1)?.content ?? '');
      const content = await this.provider.reply(history, { ...options, signal, sources });
      signal.throwIfAborted();
      return await this.db.run(async (tx) => {
        const [session] = await tx
          .select()
          .from(productAiSessions)
          .where(eq(productAiSessions.id, sessionId))
          .for('update');
        if (!session || session.deletedAt || session.replyLeaseId !== leaseId || session.replyStatus !== 'running') {
          throw new ConflictException('다른 요청에서 답변 처리를 이어받았습니다. 대화를 새로 확인해 주세요.');
        }
        const revision = session.revision + 1;
        await tx.insert(productAiMessages).values({
          sessionId,
          requestId: randomUUID(),
          sequence: revision,
          role: 'assistant',
          content,
          sources,
        });
        await tx
          .update(productAiSessions)
          .set({
            revision,
            replyStatus: 'idle',
            replyLeaseId: null,
            replyLeaseUntil: null,
            replyError: null,
            updatedAt: new Date(),
          })
          .where(eq(productAiSessions.id, sessionId));
        return { status: 'idle' as const };
      });
    } catch (error) {
      const message =
        error instanceof ServiceUnavailableException
          ? error.message
          : 'AI 응답 처리가 중단되었습니다. 다시 시도해 주세요.';
      await this.db.db
        .update(productAiSessions)
        .set({
          replyStatus: 'failed',
          replyLeaseId: null,
          replyLeaseUntil: null,
          replyError: message,
        })
        .where(and(eq(productAiSessions.id, sessionId), eq(productAiSessions.replyLeaseId, leaseId)));
      throw new ServiceUnavailableException(message);
    } finally {
      this.running.delete(leaseId);
    }
  }
}
