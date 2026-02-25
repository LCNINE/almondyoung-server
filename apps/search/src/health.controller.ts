import { Controller, Get } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';

@Controller('health')
export class HealthController {
  constructor(private readonly openSearchService: OpenSearchService) {}

  @Get()
  async check() {
    const opensearchOk = await this.openSearchService.ping();
    return {
      status: opensearchOk ? 'ok' : 'degraded',
      service: 'search',
      opensearch: opensearchOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}
