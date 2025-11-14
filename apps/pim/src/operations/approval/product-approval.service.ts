import { Injectable, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { eq } from 'drizzle-orm';
import {
  type PimSchema,
  productMasters,
  productApprovalHistory,
} from '../../schema';
import { DbTransaction, NewProductApprovalHistory } from '../../types';

@Injectable()
export class ProductApprovalService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  async submitForApproval(productId: string, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const [product] = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'draft') {
      throw new BadRequestException('Product is not in draft status');
    }

    const [updated] = await client
      .update(productMasters)
      .set({
        approvalStatus: 'pending',
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(productMasters.id, productId))
      .returning();

    await this.addHistory({
      productId,
      status: 'pending',
      comment: 'Submitted for approval',
      approvedBy: userId,
    }, tx);

    return updated;
  }

  async approve(productId: string, userId: string, comment?: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const [product] = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'pending') {
      throw new BadRequestException('Product is not pending approval');
    }

    const [updated] = await client
      .update(productMasters)
      .set({
        approvalStatus: 'approved',
        approvedAt: new Date(),
        approvedBy: userId,
        status: 'active', // Activate product upon approval
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, productId))
      .returning();

    await this.addHistory({
      productId,
      status: 'approved',
      comment: comment || 'Approved',
      approvedBy: userId,
    }, tx);

    return updated;
  }

  async reject(productId: string, userId: string, reason: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const [product] = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, productId));

    if (!product) {
      throw new BadRequestException('Product not found');
    }

    if (product.approvalStatus !== 'pending') {
      throw new BadRequestException('Product is not pending approval');
    }

    const [updated] = await client
      .update(productMasters)
      .set({
        approvalStatus: 'rejected',
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, productId))
      .returning();

    await this.addHistory({
      productId,
      status: 'rejected',
      comment: reason,
      approvedBy: userId,
    }, tx);

    return updated;
  }

  async getPendingApprovals(tx?: DbTransaction) {
    const client = this.getClient(tx);

    return client
      .select()
      .from(productMasters)
      .where(eq(productMasters.approvalStatus, 'pending'));
  }

  async getApprovalHistory(productId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    return client
      .select()
      .from(productApprovalHistory)
      .where(eq(productApprovalHistory.productId, productId))
      .orderBy(productApprovalHistory.createdAt);
  }

  private async addHistory(data: NewProductApprovalHistory, tx?: DbTransaction) {
    const client = this.getClient(tx);
    
    await client.insert(productApprovalHistory).values(data);
  }
}

