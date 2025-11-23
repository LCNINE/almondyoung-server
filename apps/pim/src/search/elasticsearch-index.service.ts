import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from './elasticsearch.service';
import {
  PIM_PRODUCTS_INDEX,
  PIM_PRODUCTS_MAPPINGS,
} from './types/index-mappings';

@Injectable()
export class ElasticsearchIndexService {
  private readonly logger = new Logger(ElasticsearchIndexService.name);

  constructor(private readonly esService: ElasticsearchService) { }

  async createProductsIndex(): Promise<void> {
    const client = this.esService.getClient();

    try {
      const exists = await client.indices.exists({ index: PIM_PRODUCTS_INDEX });

      if (exists) {
        this.logger.log(`Index ${PIM_PRODUCTS_INDEX} already exists`);
        return;
      }

      await client.indices.create({
        index: PIM_PRODUCTS_INDEX,
        settings: {
          number_of_shards: 2,
          number_of_replicas: 1,
        },
        mappings: PIM_PRODUCTS_MAPPINGS,
      });

      this.logger.log(`✅ Created index: ${PIM_PRODUCTS_INDEX}`);
    } catch (error) {
      this.logger.error(`❌ Failed to create index: ${PIM_PRODUCTS_INDEX}`, error.stack);
      throw error;
    }
  }

  async deleteProductsIndex(): Promise<void> {
    const client = this.esService.getClient();

    try {
      const exists = await client.indices.exists({ index: PIM_PRODUCTS_INDEX });

      if (!exists) {
        this.logger.log(`Index ${PIM_PRODUCTS_INDEX} does not exist`);
        return;
      }

      await client.indices.delete({ index: PIM_PRODUCTS_INDEX });
      this.logger.log(`✅ Deleted index: ${PIM_PRODUCTS_INDEX}`);
    } catch (error) {
      this.logger.error(`❌ Failed to delete index: ${PIM_PRODUCTS_INDEX}`, error.stack);
      throw error;
    }
  }

  async updateMappings(): Promise<void> {
    const client = this.esService.getClient();

    try {
      await client.indices.putMapping({
        index: PIM_PRODUCTS_INDEX,
        ...PIM_PRODUCTS_MAPPINGS,
      });

      this.logger.log(`✅ Updated mappings for: ${PIM_PRODUCTS_INDEX}`);
    } catch (error) {
      this.logger.error(`❌ Failed to update mappings: ${PIM_PRODUCTS_INDEX}`, error.stack);
      throw error;
    }
  }

  async reindexProducts(): Promise<void> {
    const newIndex = `${PIM_PRODUCTS_INDEX}_new`;
    const client = this.esService.getClient();

    try {
      await client.indices.create({
        index: newIndex,
        settings: {
          number_of_shards: 2,
          number_of_replicas: 1,
        },
        mappings: PIM_PRODUCTS_MAPPINGS,
      });

      await client.reindex({
        source: { index: PIM_PRODUCTS_INDEX },
        dest: { index: newIndex },
      });

      await client.indices.delete({ index: PIM_PRODUCTS_INDEX });

      await client.indices.updateAliases({
        actions: [
          { add: { index: newIndex, alias: PIM_PRODUCTS_INDEX } },
        ],
      });

      this.logger.log(`✅ Reindexed products to ${newIndex}`);
    } catch (error) {
      this.logger.error('❌ Failed to reindex products', error.stack);
      throw error;
    }
  }
}

