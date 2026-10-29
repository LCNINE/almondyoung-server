import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { skus } from '../../../../inventory/schema/inventory.schema';
import { InjectPublisher, PublisherFor } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DbTransaction } from '../../../catalog.types';
import { productMasters, productMasterVariants, productMasterVersions } from '../../../schema/catalog.schema';
import { ProjectionSnapshotAssembler } from '../assemblers/projection-snapshot.assembler';
import { ProductModel3dLoader } from '../loaders/product-model3d.loader';
import { lockProductMasters } from './product-master-lock';

export type Model3dProjectionTarget = { masterId: string; versionId: string };

@Injectable()
export class ProductModel3dProjection {
  constructor(
    private readonly modelLoader: ProductModel3dLoader,
    private readonly assembler: ProjectionSnapshotAssembler,
    @InjectPublisher(PRODUCT_STREAM) private readonly publisher: PublisherFor<typeof PRODUCT_STREAM>,
  ) {}

  async lockSkus(tx: DbTransaction, ids: string[]) {
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

  async lockVariantTargets(tx: DbTransaction, variantIds: string[]): Promise<Model3dProjectionTarget[]> {
    const masters = await tx
      .selectDistinct({ masterId: productMasterVariants.masterId })
      .from(productMasterVariants)
      .where(inArray(productMasterVariants.variantId, variantIds));

    // 공개 경로와 같은 master → variant 순서로 잠가 검수·재매칭을 직렬화한다.
    await lockProductMasters(
      tx,
      masters.map((master) => master.masterId),
    );

    return tx
      .selectDistinct({ masterId: productMasterVariants.masterId, versionId: productMasterVariants.versionId })
      .from(productMasterVariants)
      .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
      .innerJoin(productMasters, eq(productMasters.id, productMasterVariants.masterId))
      .where(
        and(
          inArray(productMasterVariants.variantId, variantIds),
          eq(productMasterVersions.status, 'active'),
          isNull(productMasterVersions.deletedAt),
          isNull(productMasters.deletedAt),
        ),
      );
  }

  async capture(tx: DbTransaction, targets: Model3dProjectionTarget[]) {
    const selections = new Map<string, string | undefined>();

    for (const target of targets) {
      selections.set(target.masterId, await this.modelLoader.getFileId(tx, target.masterId, target.versionId));
    }

    return selections;
  }

  async refresh(
    tx: DbTransaction,
    targets: Model3dProjectionTarget[],
    before: Map<string, string | undefined>,
    bulk = false,
  ) {
    for (const { masterId, versionId } of targets) {
      const after = await this.modelLoader.getFileId(tx, masterId, versionId);

      // 비대표 SKU의 승인·메모 변경은 고객에게 보일 파일이 같으므로 재발행하지 않는다.
      if (before.get(masterId) === after) {
        continue;
      }

      const assembly = await this.assembler.assembleActiveVersionSnapshot(masterId, versionId, tx);

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
}
