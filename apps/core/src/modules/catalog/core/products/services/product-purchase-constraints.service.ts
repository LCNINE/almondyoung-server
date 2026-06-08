import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, count, eq, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DbTransaction, PurchaseConstraintReadModel } from '../../../catalog.types';
import {
  type PimSchema,
  productMasterPurchaseConstraints,
  productMasterVersions,
  productPurchaseConstraints,
} from '../../../schema/catalog.schema';
import { UpsertPurchaseConstraintDto } from '../dto/purchase-constraints';

type PurchaseConstraintMapping = {
  id: string;
  masterId: string;
  versionId: string;
  purchaseConstraintId: string;
};

type ProductVersionRef = {
  id: string;
  masterId: string;
  status: string;
};

@Injectable()
export class ProductPurchaseConstraintsService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private get client() {
    return this.db.db;
  }

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.client.transaction(fn);
  }

  isDeleteIntent(input: UpsertPurchaseConstraintDto): boolean {
    return input.requiresMembership === false && input.lifetimeQuantityLimit == null;
  }

  assertValidInput(input: UpsertPurchaseConstraintDto): void {
    if (input.lifetimeQuantityLimit != null && input.lifetimeQuantityLimit <= 0) {
      throw new BadRequestException('lifetimeQuantityLimit must be greater than 0');
    }
  }

  async getForVersion(
    masterId: string,
    versionId: string,
    tx?: DbTransaction,
  ): Promise<PurchaseConstraintReadModel | null> {
    return this.inTx(async (tx) => {
      await this.assertVersionBelongsToMaster(masterId, versionId, tx);

      const [row] = await tx
        .select({
          id: productPurchaseConstraints.id,
          requiresMembership: productPurchaseConstraints.requiresMembership,
          lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
        })
        .from(productMasterPurchaseConstraints)
        .innerJoin(
          productPurchaseConstraints,
          eq(productMasterPurchaseConstraints.purchaseConstraintId, productPurchaseConstraints.id),
        )
        .where(
          and(
            eq(productMasterPurchaseConstraints.masterId, masterId),
            eq(productMasterPurchaseConstraints.versionId, versionId),
          ),
        )
        .limit(1);

      return row ?? null;
    }, tx);
  }

  async upsertForDraft(
    masterId: string,
    versionId: string,
    input: UpsertPurchaseConstraintDto,
    tx?: DbTransaction,
  ): Promise<PurchaseConstraintReadModel | null> {
    this.assertValidInput(input);

    return this.inTx(async (tx) => {
      await this.assertDraftVersion(masterId, versionId, tx);

      if (this.isDeleteIntent(input)) {
        await this.deleteForDraft(masterId, versionId, tx);
        return null;
      }

      const values = {
        requiresMembership: input.requiresMembership,
        lifetimeQuantityLimit: input.lifetimeQuantityLimit ?? null,
      };
      const mapping = await this.getMapping(masterId, versionId, tx);

      if (!mapping) {
        const [constraint] = await tx
          .insert(productPurchaseConstraints)
          .values({
            id: uuidv7(),
            ...values,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({
            id: productPurchaseConstraints.id,
            requiresMembership: productPurchaseConstraints.requiresMembership,
            lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
          });

        await tx.insert(productMasterPurchaseConstraints).values({
          id: uuidv7(),
          masterId,
          versionId,
          purchaseConstraintId: constraint.id,
          createdAt: new Date(),
        });

        return constraint;
      }

      const isShared = await this.isConstraintShared(mapping.purchaseConstraintId, versionId, tx);

      if (isShared) {
        const [constraint] = await tx
          .insert(productPurchaseConstraints)
          .values({
            id: uuidv7(),
            ...values,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({
            id: productPurchaseConstraints.id,
            requiresMembership: productPurchaseConstraints.requiresMembership,
            lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
          });

        await tx
          .update(productMasterPurchaseConstraints)
          .set({ purchaseConstraintId: constraint.id })
          .where(eq(productMasterPurchaseConstraints.id, mapping.id));

        await this.deleteIfOrphan(mapping.purchaseConstraintId, tx);

        return constraint;
      }

      const [constraint] = await tx
        .update(productPurchaseConstraints)
        .set({
          ...values,
          updatedAt: new Date(),
        })
        .where(eq(productPurchaseConstraints.id, mapping.purchaseConstraintId))
        .returning({
          id: productPurchaseConstraints.id,
          requiresMembership: productPurchaseConstraints.requiresMembership,
          lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
        });

      return constraint;
    }, tx);
  }

  async deleteForDraft(masterId: string, versionId: string, tx?: DbTransaction): Promise<void> {
    await this.inTx(async (tx) => {
      await this.assertDraftVersion(masterId, versionId, tx);

      const mapping = await this.getMapping(masterId, versionId, tx);
      if (!mapping) {
        return;
      }

      await tx.delete(productMasterPurchaseConstraints).where(eq(productMasterPurchaseConstraints.id, mapping.id));
      await this.deleteIfOrphan(mapping.purchaseConstraintId, tx);
    }, tx);
  }

  async copyMapping(masterId: string, fromVersionId: string, toVersionId: string, tx: DbTransaction): Promise<void> {
    await this.assertVersionBelongsToMaster(masterId, fromVersionId, tx);
    await this.assertVersionBelongsToMaster(masterId, toVersionId, tx);

    const mapping = await this.getMapping(masterId, fromVersionId, tx);
    if (!mapping) {
      return;
    }

    await tx.insert(productMasterPurchaseConstraints).values({
      id: uuidv7(),
      masterId,
      versionId: toVersionId,
      purchaseConstraintId: mapping.purchaseConstraintId,
      createdAt: new Date(),
    });
  }

  private async assertVersionBelongsToMaster(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<ProductVersionRef> {
    const [version] = await tx
      .select({
        id: productMasterVersions.id,
        masterId: productMasterVersions.masterId,
        status: productMasterVersions.status,
      })
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, versionId))
      .limit(1);

    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    if (version.masterId !== masterId) {
      throw new BadRequestException(`Version ${versionId} does not belong to master ${masterId}`);
    }

    return version;
  }

  private async assertDraftVersion(masterId: string, versionId: string, tx: DbTransaction): Promise<ProductVersionRef> {
    const version = await this.assertVersionBelongsToMaster(masterId, versionId, tx);
    if (version.status !== 'draft') {
      throw new BadRequestException('Purchase constraints can only be modified on draft versions');
    }

    return version;
  }

  private async getMapping(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<PurchaseConstraintMapping | null> {
    const [mapping] = await tx
      .select({
        id: productMasterPurchaseConstraints.id,
        masterId: productMasterPurchaseConstraints.masterId,
        versionId: productMasterPurchaseConstraints.versionId,
        purchaseConstraintId: productMasterPurchaseConstraints.purchaseConstraintId,
      })
      .from(productMasterPurchaseConstraints)
      .where(
        and(
          eq(productMasterPurchaseConstraints.masterId, masterId),
          eq(productMasterPurchaseConstraints.versionId, versionId),
        ),
      )
      .limit(1);

    return mapping ?? null;
  }

  private async isConstraintShared(
    purchaseConstraintId: string,
    currentVersionId: string,
    tx: DbTransaction,
  ): Promise<boolean> {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(productMasterPurchaseConstraints)
      .where(
        and(
          eq(productMasterPurchaseConstraints.purchaseConstraintId, purchaseConstraintId),
          ne(productMasterPurchaseConstraints.versionId, currentVersionId),
        ),
      );

    return Number(value) > 0;
  }

  private async deleteIfOrphan(purchaseConstraintId: string, tx: DbTransaction): Promise<void> {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(productMasterPurchaseConstraints)
      .where(eq(productMasterPurchaseConstraints.purchaseConstraintId, purchaseConstraintId));

    if (Number(value) === 0) {
      await tx.delete(productPurchaseConstraints).where(eq(productPurchaseConstraints.id, purchaseConstraintId));
    }
  }
}
