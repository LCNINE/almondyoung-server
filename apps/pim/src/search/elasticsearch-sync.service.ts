import { Injectable, Logger } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';
import { DbService, InjectDb } from '@app/db';
import { ElasticsearchService } from './elasticsearch.service';
import {
  PIM_PRODUCTS_INDEX,
  ElasticsearchProductDocument,
} from './types/index-mappings';
import { type PimSchema, productMasterVersions, productCategories, productMasterCategories, productTagValues, tagValues, tagGroups } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { DbTransaction } from '../types';

interface ProductMasterActiveVersionChangedPayload {
  masterId: string;
  productId: string | null;
  versionId: string | null;
  name: string | null;
  previousActiveVersionId: string | null;
  changeReason: 'published' | 'unpublished' | 'rollback';
  changedAt: string;
}

interface ProductMasterDeletedPayload {
  masterId: string;
  deletedAt: string;
}

@Injectable()
export class ElasticsearchSyncService {
  private readonly logger = new Logger(ElasticsearchSyncService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly esService: ElasticsearchService,
  ) { }

  @EventPattern('products.events.v1')
  async handleProductEvent(data: any) {
    const envelope = data;
    const messageType = envelope.messageType;

    try {
      switch (messageType) {
        case 'ProductMasterActiveVersionChanged':
          await this.handleActiveVersionChanged(envelope.payload);
          break;
        case 'ProductMasterDeleted':
          await this.handleMasterDeleted(envelope.payload);
          break;
        default:
          this.logger.debug(`Ignoring event type: ${messageType}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle event ${messageType}`,
        error.stack,
      );
      throw error;
    }
  }

  private async handleActiveVersionChanged(
    payload: ProductMasterActiveVersionChangedPayload,
  ): Promise<void> {
    const { masterId, productId, versionId } = payload;

    if (!productId || versionId === null) {
      this.logger.log(`Unpublished master ${masterId}, deleting from ES`);
      await this.deleteProductFromEs(masterId);
      return;
    }

    this.logger.log(
      `Syncing active version ${versionId} of master ${masterId} to ES`,
    );
    const document = await this._buildElasticsearchDocument(productId, versionId);
    await this.indexProductToEs(masterId, document);
  }

  private async handleMasterDeleted(
    payload: ProductMasterDeletedPayload,
  ): Promise<void> {
    const { masterId } = payload;
    this.logger.log(`Deleting master ${masterId} from ES`);
    await this.deleteProductFromEs(masterId);
  }

  private async _buildElasticsearchDocument(
    productId: string,
    versionId: string,
  ): Promise<ElasticsearchProductDocument> {
    return this.db.db.transaction(async (tx) => {
      const [product] = await tx
        .select({
          id: productMasterVersions.id,
          masterId: productMasterVersions.masterId,
          versionId: productMasterVersions.id,
          name: productMasterVersions.name,
          description: productMasterVersions.description,
          productCode: productMasterVersions.productCode,
          brand: productMasterVersions.brand,
          status: productMasterVersions.status,
          approvalStatus: productMasterVersions.approvalStatus,
          marketPrice: productMasterVersions.marketPrice,
          categoryId: productCategories.id,
          categoryName: productCategories.name,
          categoryPath: productCategories.path,
          createdAt: productMasterVersions.createdAt,
          updatedAt: productMasterVersions.updatedAt,
        })
        .from(productMasterVersions)
        .leftJoin(
          productMasterCategories,
          and(
            eq(productMasterVersions.masterId, productMasterCategories.masterId),
            eq(productMasterVersions.id, productMasterCategories.versionId),
          ),
        )
        .leftJoin(
          productCategories,
          eq(productMasterCategories.categoryId, productCategories.id),
        )
        .where(
          and(
            eq(productMasterVersions.id, productId),
            isNull(productMasterVersions.deletedAt),
          ),
        )
        .limit(1);

      if (!product) {
        throw new Error(`Product ${productId} not found`);
      }

      const tagsData = await tx
        .select({
          groupId: tagGroups.id,
          groupName: tagGroups.name,
          valueId: tagValues.id,
          valueName: tagValues.name,
          groupDisplayOrder: tagGroups.displayOrder,
          valueDisplayOrder: tagValues.displayOrder,
        })
        .from(productTagValues)
        .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
        .innerJoin(tagGroups, eq(tagValues.groupId, tagGroups.id))
        .where(
          and(
            eq(productTagValues.masterId, product.masterId),
            eq(productTagValues.versionId, product.id),
            eq(tagGroups.isActive, true),
            eq(tagValues.isActive, true),
          ),
        )
        .orderBy(tagGroups.displayOrder, tagValues.displayOrder);

      const tags = tagsData.map((tag) => ({
        group_id: tag.groupId,
        group_name: tag.groupName,
        value_id: tag.valueId,
        value_name: tag.valueName,
      }));

      const tagValueIds = tagsData.map((tag) => tag.valueId);

      return {
        master_id: product.masterId,
        product_id: product.id,
        version_id: product.id,
        name: product.name,
        description: product.description,
        product_code: product.productCode,
        brand: product.brand,
        status: product.status,
        approval_status: product.approvalStatus,
        price: product.marketPrice ? Number(product.marketPrice) : null,
        category_id: product.categoryId ?? null,
        category_name: product.categoryName ?? null,
        category_path: product.categoryPath ?? null,
        tags,
        tag_value_ids: tagValueIds,
        created_at: product.createdAt?.toISOString() || new Date().toISOString(),
        updated_at: product.updatedAt?.toISOString() || new Date().toISOString(),
      };
    });
  }

  private async indexProductToEs(
    masterId: string,
    document: ElasticsearchProductDocument,
  ): Promise<void> {
    const client = this.esService.getClient();

    try {
      await client.index({
        index: PIM_PRODUCTS_INDEX,
        id: masterId,
        document,
      });

      this.logger.log(`✅ Indexed product ${masterId} to Elasticsearch`);
    } catch (error) {
      this.logger.error(
        `❌ Failed to index product ${masterId}`,
        error.stack,
      );
      throw error;
    }
  }

  private async deleteProductFromEs(masterId: string): Promise<void> {
    const client = this.esService.getClient();

    try {
      await client.delete({
        index: PIM_PRODUCTS_INDEX,
        id: masterId,
      });

      this.logger.log(`✅ Deleted product ${masterId} from Elasticsearch`);
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        this.logger.debug(`Product ${masterId} not found in ES (already deleted)`);
      } else {
        this.logger.error(
          `❌ Failed to delete product ${masterId}`,
          error.stack,
        );
        throw error;
      }
    }
  }
}

