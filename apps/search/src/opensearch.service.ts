import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { DEFAULT_PRODUCTS_INDEX } from './types/product-document.type';
import { DEFAULT_QUERY_EVENTS_INDEX } from './types/query-keyword-document.type';

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    const node =
      this.configService.get<string>('OPENSEARCH_NODE') ||
      this.configService.get<string>('ELASTICSEARCH_NODE') ||
      'http://localhost:9200';
    const username =
      this.configService.get<string>('OPENSEARCH_USERNAME') ||
      this.configService.get<string>('ELASTICSEARCH_USERNAME');
    const password =
      this.configService.get<string>('OPENSEARCH_PASSWORD') ||
      this.configService.get<string>('ELASTICSEARCH_PASSWORD');

    this.client = new Client({
      node,
      auth: username && password ? { username, password } : undefined,
    });

    this.logger.log(`OpenSearch client configured with node: ${node}`);
  }

  async onModuleInit(): Promise<void> {
    try {
      const health = await this.client.cluster.health();
      this.logger.log(`OpenSearch connected: ${health.body.status}`);
    } catch (error) {
      this.logger.error('Failed to connect to OpenSearch', error.stack);
      throw error;
    }
  }

  getClient(): Client {
    return this.client;
  }

  getProductsIndex(): string {
    return (
      this.configService.get<string>('SEARCH_PRODUCTS_INDEX') ||
      DEFAULT_PRODUCTS_INDEX
    );
  }

  getQueryEventsIndex(): string {
    return (
      this.configService.get<string>('SEARCH_QUERY_EVENTS_INDEX') ||
      DEFAULT_QUERY_EVENTS_INDEX
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
