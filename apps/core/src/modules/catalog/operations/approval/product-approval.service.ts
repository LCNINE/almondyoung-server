import { Injectable, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { type PimSchema, productMasterVersions, productApprovalHistory } from '../../schema/catalog.schema';
import { DbTransaction, DbClient, NewProductApprovalHistory } from '../../catalog.types';

@Injectable()
export class ProductApprovalService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction): DbClient {
    return tx ?? this.db.db;
  }

  async submitForApproval(productId: string, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const [product] = await client.select().from(productMasterVersions).where(eq(productMasterVersions.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'draft') {
      throw new BadRequestException('Product is not in draft status');
    }

    const [updated] = await client
      .update(productMasterVersions)
      .set({
        approvalStatus: 'pending',
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(productMasterVersions.id, productId))
      .returning();

    await this.addHistory(
      {
        versionId: productId,
        status: 'pending',
        comment: 'Submitted for approval',
        approvedBy: userId,
      },
      tx,
    );

    return updated;
  }

  async approve(productId: string, userId: string, comment?: string, tx?: DbTransaction) {
    return this.db.run(async (trx) => {
      const [product] = await trx.select().from(productMasterVersions).where(eq(productMasterVersions.id, productId));

      if (!product) {
        throw new BadRequestException('Product not found');
      }

      if (product.approvalStatus !== 'pending') {
        throw new BadRequestException('Product is not pending approval');
      }

      await trx
        .update(productMasterVersions)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(and(eq(productMasterVersions.masterId, product.masterId), eq(productMasterVersions.status, 'active')));

      const [updated] = await trx
        .update(productMasterVersions)
        .set({
          approvalStatus: 'approved',
          approvedAt: new Date(),
          approvedBy: userId,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(productMasterVersions.id, productId))
        .returning();

      await this.addHistory(
        {
          versionId: productId,
          status: 'approved',
          comment: comment || 'Approved',
          approvedBy: userId,
        },
        trx,
      );

      return updated;
    }, tx);
  }

  async reject(productId: string, userId: string, reason: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const [product] = await client.select().from(productMasterVersions).where(eq(productMasterVersions.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'pending') {
      throw new BadRequestException('Product is not pending approval');
    }

    const [updated] = await client
      .update(productMasterVersions)
      .set({
        approvalStatus: 'rejected',
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(productMasterVersions.id, productId))
      .returning();

    await this.addHistory(
      {
        versionId: productId,
        status: 'rejected',
        comment: reason,
        approvedBy: userId,
      },
      tx,
    );

    return updated;
  }

  async getPendingApprovals(tx?: DbTransaction) {
    const client = this.getClient(tx);

    return client.select().from(productMasterVersions).where(eq(productMasterVersions.approvalStatus, 'pending'));
  }

  async getApprovalHistory(productId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    return client
      .select()
      .from(productApprovalHistory)
      .where(eq(productApprovalHistory.versionId, productId))
      .orderBy(productApprovalHistory.createdAt);
  }

  private async addHistory(data: NewProductApprovalHistory, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client.insert(productApprovalHistory).values(data);
  }
}
