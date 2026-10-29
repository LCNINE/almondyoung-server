import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, NotFoundError } from '@app/shared';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { productMasters, productMasterVariants, productMasterVersions } from '../../catalog/schema/catalog.schema';
import { DbTransaction } from '../../catalog/catalog.types';
import { ProjectionSnapshotAssembler } from '../../catalog/core/products/assemblers/projection-snapshot.assembler';
import { ProductModel3dLoader } from '../../catalog/core/products/loaders/product-model3d.loader';
import { lockProductMasters } from '../../catalog/core/products/services/product-master-lock';
import {
  DbTx,
  productMatchings,
  productVariantSkuLinks,
  sku3dModels,
  skus,
  Sku3dModelStatus,
  wmsSchema,
} from '../schema/inventory.schema';
import { FileServiceClient } from '../../library/clients/file-service.client';

export type ModelReviewInput = {
  status: Sku3dModelStatus;
  notes?: Record<string, unknown>;
};

export type RegisterModelInput = ModelReviewInput & {
  glbFileId?: string;
};

type Target = { masterId: string; versionId: string };

@Injectable()
export class Sku3dModelsManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly files: FileServiceClient,
    private readonly modelLoader: ProductModel3dLoader,
    private readonly assembler: ProjectionSnapshotAssembler,
    @InjectPublisher(PRODUCT_STREAM) private readonly publisher: PublisherFor<typeof PRODUCT_STREAM>,
  ) {}

  async list(skuId: string) {
    return this.db.db.select().from(sku3dModels).where(eq(sku3dModels.skuId, skuId)).orderBy(desc(sku3dModels.version));
  }

  async register(skuId: string, input: RegisterModelInput, actorId: string) {
    return this.db.run(async (tx) => {
      // 같은 SKU의 재생성·검수를 줄 세워 MAX(version) + 1이 중복되지 않게 한다.
      await this.lockSkus(tx, [skuId]);

      const [latest] = await tx
        .select({ version: max(sku3dModels.version) })
        .from(sku3dModels)
        .where(eq(sku3dModels.skuId, skuId));

      await this.validateFile(input.status, input.glbFileId, actorId);

      const targets = input.status === 'approved' ? await this.lockTargets(tx, [skuId]) : [];
      const before = await this.selections(tx, targets);
      const [model] = await tx
        .insert(sku3dModels)
        .values({
          skuId,
          version: (latest?.version ?? 0) + 1,
          glbFileId: input.glbFileId ?? null,
          status: input.status,
          notes: input.notes ?? {},
        })
        .returning();

      await this.refreshChangedProducts(tx, targets, before);

      return model;
    });
  }

  async review(id: string, input: ModelReviewInput, actorId: string) {
    const models = await this.reviewModels([id], input, actorId, false);

    return models[0];
  }

  async reviewBatch(ids: string[], input: ModelReviewInput, actorId: string) {
    return this.reviewModels(ids, input, actorId, true);
  }

  private async reviewModels(ids: string[], input: ModelReviewInput, actorId: string, bulk: boolean) {
    const uniqueIds = [...new Set(ids)].sort();

    if (uniqueIds.length === 0) {
      throw new BadRequestError('At least one model is required');
    }

    return this.db.run(async (tx) => {
      const initial = await tx.select().from(sku3dModels).where(inArray(sku3dModels.id, uniqueIds));

      if (initial.length !== uniqueIds.length) {
        throw new NotFoundError('SKU 3D model not found');
      }

      const skuIds = [...new Set(initial.map((model) => model.skuId))].sort();
      await this.lockSkus(tx, skuIds);

      // 서로 다른 SKU를 동시에 검수해도 같은 상품의 대표 모델 비교는 순서대로 진행한다.
      const targets = await this.lockTargets(tx, skuIds);
      const before = await this.selections(tx, targets);
      const models = await tx.select().from(sku3dModels).where(inArray(sku3dModels.id, uniqueIds));

      for (const model of models) {
        await this.validateFile(input.status, model.glbFileId, actorId);
      }

      const updated = await tx
        .update(sku3dModels)
        .set({ status: input.status, ...(input.notes === undefined ? {} : { notes: input.notes }) })
        .where(inArray(sku3dModels.id, uniqueIds))
        .returning();

      await this.refreshChangedProducts(tx, targets, before, bulk);

      return updated;
    });
  }

  private async validateFile(status: Sku3dModelStatus, fileId: string | null | undefined, actorId: string) {
    if (status !== 'approved') {
      return;
    }

    if (!fileId) {
      throw new BadRequestError('GLB file is required for approval');
    }

    const file = await this.files.fetchMetadata(fileId, actorId);

    if (
      file.status !== 'active' ||
      file.isPublic !== true ||
      file.contextId !== 'sku-3d-model' ||
      file.mimeType !== 'model/gltf-binary'
    ) {
      throw new BadRequestError('Approval requires a completed public sku-3d-model GLB');
    }
  }

  private async lockSkus(tx: DbTx, ids: string[]) {
    const rows = await tx
      .select({ id: skus.id, isDeleted: skus.isDeleted })
      .from(skus)
      .where(inArray(skus.id, ids))
      .orderBy(asc(skus.id))
      // SKU ID는 바꾸지 않으므로 공개 작업의 FK KEY SHARE와 충돌할 필요가 없다.
      .for('no key update');

    if (rows.length !== ids.length || rows.some((sku) => sku.isDeleted)) {
      throw new NotFoundError('SKU not found');
    }
  }

  private async lockTargets(tx: DbTx, skuIds: string[]): Promise<Target[]> {
    // 첫 공개 중인 상품도 기다리도록 활성 여부와 무관하게 연결된 모든 상품을 먼저 찾는다.
    const masters = await tx
      .selectDistinct({ masterId: productMasterVariants.masterId })
      .from(productVariantSkuLinks)
      .innerJoin(productMatchings, eq(productMatchings.id, productVariantSkuLinks.productMatchingId))
      .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productMatchings.variantId))
      .where(inArray(productVariantSkuLinks.skuId, skuIds));

    await lockProductMasters(
      tx,
      masters.map((master) => master.masterId),
    );

    // 잠금 대기 사이 공개·판매중단된 버전이 있을 수 있으므로 현재 대상을 다시 읽는다.
    return tx
      .selectDistinct({ masterId: productMasterVariants.masterId, versionId: productMasterVariants.versionId })
      .from(productVariantSkuLinks)
      .innerJoin(productMatchings, eq(productMatchings.id, productVariantSkuLinks.productMatchingId))
      .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productMatchings.variantId))
      .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
      .innerJoin(productMasters, eq(productMasters.id, productMasterVariants.masterId))
      .where(
        and(
          inArray(productVariantSkuLinks.skuId, skuIds),
          eq(productMasterVersions.status, 'active'),
          isNull(productMasterVersions.deletedAt),
          isNull(productMasters.deletedAt),
        ),
      );
  }

  private async selections(tx: DbTx, targets: Target[]) {
    const selections = new Map<string, string | undefined>();

    for (const target of targets) {
      selections.set(
        target.masterId,
        await this.modelLoader.getFileId(this.catalogTx(tx), target.masterId, target.versionId),
      );
    }

    return selections;
  }

  private async refreshChangedProducts(
    tx: DbTx,
    targets: Target[],
    before: Map<string, string | undefined>,
    bulk = false,
  ) {
    for (const { masterId, versionId } of targets) {
      const after = await this.modelLoader.getFileId(this.catalogTx(tx), masterId, versionId);

      // 비대표 SKU의 승인·메모 변경은 고객에게 보일 파일이 같으므로 재발행하지 않는다.
      if (before.get(masterId) === after) {
        continue;
      }

      const assembly = await this.assembler.assembleActiveVersionSnapshot(masterId, versionId, this.catalogTx(tx));

      // 조립·outbox 실패를 전파해 검수 상태만 저장되고 고객 반영이 누락되는 일을 막는다.
      await this.publisher.enqueue(
        {
          eventType: 'ProductMasterActiveVersionChanged',
          aggregateId: masterId,
          payload: {
            masterId,
            versionId,
            previousActiveVersionId: null,
            name: assembly.snapshot.name,
            categoryIds: assembly.categoryIds,
            primaryCategoryId: assembly.primaryCategoryId,
            changeReason: 'published',
            changedAt: new Date().toISOString(),
            snapshot: assembly.snapshot,
            // 일괄 검수는 단건 상품 수정을 막지 않도록 소비자의 대량 처리 레인으로 보낸다.
            ...(bulk ? { origin: 'bulk_import' as const } : {}),
          },
        },
        tx,
      );
    }
  }

  private catalogTx(tx: DbTx): DbTransaction {
    // inventory와 catalog는 같은 core DB 연결과 트랜잭션을 공유한다.
    return tx as unknown as DbTransaction;
  }
}
