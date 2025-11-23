import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private client: Client;

  constructor(private readonly configService: ConfigService) {
    const node = this.configService.get<string>('ELASTICSEARCH_NODE');
    const username = this.configService.get<string>('ELASTICSEARCH_USERNAME');
    const password = this.configService.get<string>('ELASTICSEARCH_PASSWORD');

    if (!node) {
      throw new Error('ELASTICSEARCH_NODE is required');
    }

    const auth = username && password
      ? { username, password }
      : undefined;

    this.client = new Client({
      node,
      auth,
    });

    this.logger.log(`Elasticsearch client configured with node: ${node}`);
  }

  async onModuleInit() {
    try {
      const health = await this.client.cluster.health();
      this.logger.log(`✅ Elasticsearch connected: ${health.status}`);
    } catch (error) {
      this.logger.error('❌ Failed to connect to Elasticsearch', error.stack);
      throw error;
    }
  }

  getClient(): Client {
    return this.client;
  }

  async healthCheck(): Promise<{ status: string; cluster_name: string }> {
    const health = await this.client.cluster.health();
    return {
      status: health.status,
      cluster_name: health.cluster_name,
    };
  }
}

