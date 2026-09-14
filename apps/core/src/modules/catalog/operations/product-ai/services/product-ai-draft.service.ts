import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  productAiMessages,
  productAiSessions,
  productMasterVersions,
  productMasters,
  type PimSchema,
} from '../../../schema/catalog.schema';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { draftImageIds, productAiDraftSchema, renderDraftHtml, renderDraftMarkdown } from '@packages/product-ai/draft';
import { type DbTransaction } from '../../../catalog.types';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { ProductAiSalesService } from './product-ai-sales.service';
import { salesProblems } from '@packages/product-ai/sales';
import { ProductAiImageService, type ProductAiFileAuth } from './product-ai-image.service';

@Injectable()
export class ProductAiDraftService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly masters: ProductMastersService,
    private readonly images: ProductAiImageService,
    private readonly sales: ProductAiSalesService,
    private readonly versions: ProductVersionsService,
  ) {}

  async save(
    ownerId: string,
    sessionId: string,
    messageId: string,
    auth: ProductAiFileAuth,
    options: { publish?: boolean; roles?: string[]; tx?: DbTransaction; signal?: AbortSignal } = {},
  ) {
    // A session owns one draft. Locking also makes repeated clicks and lost-response retries idempotent.
    return this.db.run(async (tx) => {
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
      if (!session) throw new NotFoundException('대화를 찾을 수 없습니다.');
      if (
        session.savedProduct?.messageId === messageId &&
        (!options.publish || session.savedProduct.status === 'active')
      )
        return session.savedProduct;
      const [message] = await tx
        .select()
        .from(productAiMessages)
        .where(
          and(
            eq(productAiMessages.id, messageId),
            eq(productAiMessages.sessionId, sessionId),
            eq(productAiMessages.role, 'assistant'),
          ),
        );
      if (!message?.productDraft) throw new NotFoundException('상품 미리보기를 찾을 수 없습니다.');
      if (session.replyStatus !== 'idle' || session.revision !== message.sequence)
        throw new ConflictException('대화가 변경됐습니다. 최신 내용으로 미리보기를 다시 요청해 주세요.');
      const parsed = productAiDraftSchema.safeParse(message.productDraft);
      if (!parsed.success) throw new BadRequestException('상품 초안을 다시 생성해 주세요.');
      const draft = parsed.data;
      if (options.publish) {
        const problems = salesProblems(draft.sales);
        if (!draft.thumbnailFileId) problems.push('대표 이미지를 선택해 주세요.');
        if (draft.pendingItems.length) problems.push(draft.pendingItems[0]);
        if (problems.length) throw new BadRequestException(problems[0]);
      }
      if (draft.sales) await this.sales.validate(draft.sales, options.roles ?? [], Boolean(options.publish), tx);
      const messages = await tx
        .select({ attachments: productAiMessages.attachments })
        .from(productAiMessages)
        .where(and(eq(productAiMessages.sessionId, sessionId), eq(productAiMessages.role, 'user')));
      const allowedIds = new Set(messages.flatMap((item) => item.attachments.map((file) => file.fileId)));
      const imageIds = draftImageIds(draft);
      if (imageIds.some((id) => !allowedIds.has(id)))
        throw new BadRequestException('대화에 첨부된 이미지만 사용할 수 있습니다.');
      // Check existing ownership/status before copying any public assets.
      const [previousRow] = session.savedProduct
        ? await tx
            .select({ version: productMasterVersions })
            .from(productMasterVersions)
            .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
            .where(
              and(
                eq(productMasterVersions.id, session.savedProduct.versionId),
                isNull(productMasters.deletedAt),
                isNull(productMasterVersions.deletedAt),
              ),
            )
            .for('update')
        : [];
      const previous = previousRow?.version;
      if (
        session.savedProduct &&
        (!previous ||
          previous.status !== 'draft' ||
          previous.draftOwnerId !== ownerId ||
          previous.masterId !== session.savedProduct!.masterId)
      )
        throw new ConflictException('이 상품은 더 이상 수정 가능한 내 초안이 아닙니다. 상품 화면에서 확인해 주세요.');
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000);
      const files = await this.images.copyForProduct(imageIds, auth, signal);
      signal.throwIfAborted();
      const descriptionHtml = renderDraftHtml(draft, new Map([...files].map(([id, file]) => [id, file.url])));
      const version = previous ?? (await this.masters.createMaster(ownerId, tx));
      await this.masters.updateVersion(
        version.id,
        {
          name: draft.name,
          description: renderDraftMarkdown(draft, new Map([...files].map(([id, file]) => [id, file.fileId]))),
          descriptionHtml,
          seoTitle: draft.seoTitle,
          seoDescription: draft.seoDescription,
          seoKeywords: draft.seoKeywords,
          thumbnailFileId: draft.thumbnailFileId ? files.get(draft.thumbnailFileId)!.fileId : null,
          additionalImageFileIds: draft.additionalImageFileIds.map((id) => files.get(id)!.fileId),
        },
        tx,
      );
      const [previousMessage] = session.savedProduct
        ? await tx
            .select({ draft: productAiMessages.productDraft })
            .from(productAiMessages)
            .where(eq(productAiMessages.id, session.savedProduct.messageId))
        : [];
      if (draft.sales)
        await this.sales.apply(version.id, version.masterId, draft.sales, previousMessage?.draft?.sales, tx);
      await tx.update(productAiMessages).set({ productDraft: draft }).where(eq(productAiMessages.id, messageId));
      signal.throwIfAborted();
      if (options.publish) await this.versions.publishVersion(version.id, tx);
      signal.throwIfAborted();
      const savedProduct = {
        masterId: version.masterId,
        versionId: version.id,
        messageId,
        status: options.publish ? ('active' as const) : ('draft' as const),
      };
      await tx
        .update(productAiSessions)
        .set({ savedProduct, updatedAt: new Date() })
        .where(eq(productAiSessions.id, sessionId));
      return savedProduct;
    }, options.tx);
  }
}
