import { Controller, Get } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { Public } from '@app/authorization';

@Controller('health')
export class HealthController {
  constructor(private readonly openSearchService: OpenSearchService) {}

  @Public()
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
