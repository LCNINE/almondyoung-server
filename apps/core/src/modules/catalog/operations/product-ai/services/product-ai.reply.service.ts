import { ProductAiImageService, type ProductAiFileAuth } from './product-ai-image.service';
import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { isNull, and, asc, eq } from 'drizzle-orm';
import { type PimSchema, productAiMessages, productAiSessions } from '../../../schema/catalog.schema';
import { ProductAiProvider } from '../providers/product-ai.provider';
import { selectProductAiGuides } from '@packages/product-ai/guides';
import type { ProductAiReplyOptions } from '../providers/product-ai.provider';
import { draftImageIds, type ProductAiDraft } from '@packages/product-ai/draft';
import { requestsPublication, hasPublicationIntent } from '@packages/product-ai/sales';
import { publicationProblems, publicationNextStep } from '@packages/product-ai/publication';
import { ProductAiSalesService } from './product-ai-sales.service';
import { ProductAiDraftService } from './product-ai-draft.service';

@Injectable()
export class ProductAiReplyService {
  private readonly running = new Map<string, AbortController>();
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly provider: ProductAiProvider,
    private readonly images: ProductAiImageService,
    private readonly sales: ProductAiSalesService,
    private readonly drafts: ProductAiDraftService,
  ) {}

  async cancel(ownerId: string, sessionId: string, messageId: string) {
    // Abort local work before waiting for its final transaction's row lock.
    const [runningSession] = await this.db.db
      .select()
      .from(productAiSessions)
      .where(
        and(
          eq(productAiSessions.id, sessionId),
          eq(productAiSessions.ownerId, ownerId),
          isNull(productAiSessions.deletedAt),
        ),
      );
    if (runningSession?.lastUserMessageId === messageId && runningSession.replyLeaseId)
      this.running.get(runningSession.replyLeaseId)?.abort();
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

  async respond(
    ownerId: string,
    sessionId: string,
    messageId: string,
    options: ProductAiReplyOptions & { fileAuth?: ProductAiFileAuth; roles?: string[] } = {},
  ) {
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
          replyLeaseUntil: new Date(Date.now() + 180_000),
          replyError: null,
        })
        .where(eq(productAiSessions.id, sessionId));
      return { acquired: true, status: 'running' as const, savedProduct: session.savedProduct };
    });
    if (!claim.acquired) return { status: claim.status };

    const abort = new AbortController();
    this.running.set(leaseId, abort);
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      abort.signal,
      AbortSignal.timeout(150_000),
    ]);
    try {
      // 이력을 조용히 잘라 이전 지시를 잊지 않는다. 요약/압축은 도구 연결 단계에서 추가한다.
      const history = await this.db.db
        .select({
          role: productAiMessages.role,
          content: productAiMessages.content,
          attachments: productAiMessages.attachments,
          productDraft: productAiMessages.productDraft,
        })
        .from(productAiMessages)
        .where(eq(productAiMessages.sessionId, sessionId))
        .orderBy(asc(productAiMessages.sequence))
        .limit(201);
      if (history.length > 200 || history.reduce((size, message) => size + message.content.length, 0) > 100_000) {
        throw new ServiceUnavailableException('대화가 길어졌습니다. 새 대화에서 상품 정보를 정리해 주세요.');
      }
      const sources = selectProductAiGuides(history.at(-1)?.content ?? '');
      const imageIds = [...new Set(history.flatMap((message) => message.attachments.map((file) => file.fileId)))];
      const imageData = imageIds.length
        ? await this.images.load(imageIds, options.fileAuth ?? {}, signal)
        : new Map<string, string>();
      const input = history.map((message) => ({
        role: message.role,
        content:
          message.content +
          (message.attachments.length ? `\n첨부 이미지 순서와 ID: ${JSON.stringify(message.attachments)}` : ''),
        imageUrls: message.attachments.map((file) => imageData.get(file.fileId)!),
      }));
      let productDraft: ProductAiDraft | null = null;
      const publishRequested = hasPublicationIntent(history);
      const previousDraft = history.findLast((message) => message.productDraft)?.productDraft;
      const approvalIndex = history.findLastIndex(
        (message) => message.role === 'user' && requestsPublication(message.content),
      );
      const reviewedDraft = history.slice(0, approvalIndex).findLast((message) => message.productDraft)?.productDraft;
      let content =
        publishRequested && claim.savedProduct?.status === 'active'
          ? '이 대화의 상품은 이미 등록·발행됐어요. 앞서 발행한 상품 링크에서 확인해 주세요.'
          : await this.provider.reply(input, {
              onDelta: options.onDelta,
              signal,
              sources,
              draftContext: JSON.stringify({
                savedProduct: claim.savedProduct,
                previousDraft: previousDraft ?? null,
                attachments: history.flatMap((message) => message.attachments),
                publishRequested,
                permission: { canCreateSku: await this.sales.canCreateSku(options.roles ?? []) },
                availableActions: [
                  '상세페이지/SEO/가격/옵션/카테고리/재고 초안',
                  '카테고리/재고/태그 검색',
                  '직접 등록 요청 시 발행',
                ],
              }),
              onLookup: (input) => this.sales.lookup(input),
              onDraft: (draft) => {
                if (draftImageIds(draft).some((id) => !imageIds.includes(id)))
                  throw new ServiceUnavailableException('초안에 없는 첨부 이미지가 포함됐습니다. 다시 요청해 주세요.');
                productDraft = draft;
              },
            });
      signal.throwIfAborted();
      // Missing fields are a normal conversation step, not an execution failure.
      const prepared = productDraft as ProductAiDraft | null;
      const problems = prepared ? publicationProblems(prepared) : [];
      if (prepared?.sales && publishRequested) {
        const unreviewedCategory = prepared.sales.categories.some(
          (category) =>
            !category.id &&
            !reviewedDraft?.sales?.categories.some(
              (old) => !old.id && old.name === category.name && old.parentId === category.parentId,
            ),
        );
        const unreviewedSku = prepared.sales.inventory.some(
          (item) =>
            item.newSkuName &&
            !reviewedDraft?.sales?.inventory.some(
              (old) =>
                old.newSkuName === item.newSkuName &&
                JSON.stringify(old.optionValues) === JSON.stringify(item.optionValues),
            ),
        );
        if (unreviewedCategory || unreviewedSku)
          problems.unshift('아래 새 카테고리·재고 품목 생성 계획을 확인한 뒤 “등록해줘”라고 말씀해 주세요.');
      }
      if (publishRequested && prepared && problems.length) {
        content = `등록 요청은 받았어요. 아직 발행되지 않았습니다. ${publicationNextStep(prepared, problems)!.question}`;
      }
      return await this.db.run(async (tx) => {
        const [session] = await tx
          .select()
          .from(productAiSessions)
          .where(eq(productAiSessions.id, sessionId))
          .for('update');
        if (
          !session ||
          session.deletedAt ||
          session.replyLeaseId !== leaseId ||
          session.replyStatus !== 'running' ||
          !session.replyLeaseUntil ||
          session.replyLeaseUntil <= new Date()
        ) {
          throw new ConflictException('다른 요청에서 답변 처리를 이어받았습니다. 대화를 새로 확인해 주세요.');
        }
        const revision = session.revision + 1;
        const [answer] = await tx
          .insert(productAiMessages)
          .values({
            sessionId,
            requestId: randomUUID(),
            sequence: revision,
            role: 'assistant',
            content,
            productDraft,
            sources,
          })
          .returning({ id: productAiMessages.id });
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
        signal.throwIfAborted();
        if (publishRequested && prepared && !problems.length) {
          await this.drafts.save(ownerId, sessionId, answer.id, options.fileAuth ?? {}, {
            publish: true,
            roles: options.roles,
            tx,
            signal,
          });
          content =
            '상품 등록·발행을 완료했어요. 아래 상품 링크에서 확인할 수 있어요. 쇼핑몰 반영에는 잠시 시간이 걸릴 수 있어요.';
          await tx.update(productAiMessages).set({ content }).where(eq(productAiMessages.id, answer.id));
        }
        signal.throwIfAborted();
        return { status: 'idle' as const };
      });
    } catch (error) {
      const message =
        error instanceof ServiceUnavailableException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
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
