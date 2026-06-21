import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { MetricsService } from '../services/metrics.service';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  // Core runs on Fastify \u2014 never use the Express `Response` API (`res.set`/`res.json`)
  // here. Set headers declaratively and return the body; failures propagate to
  // GlobalExceptionFilter (\u2192 500 with a logged stack).
  @Get()
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @ApiOperation({
    summary: '\uba54\ud2b8\ub9ad \uc870\ud68c',
    description:
      'Prometheus \ud615\uc2dd\uc758 WMS \uba54\ud2b8\ub9ad \ub370\uc774\ud130\ub97c \uc81c\uacf5\ud569\ub2c8\ub2e4.',
  })
  @ApiResponse({
    status: 200,
    description: '\uba54\ud2b8\ub9ad \ub370\uc774\ud130 \uc81c\uacf5 \uc131\uacf5',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  @ApiResponse({
    status: 500,
    description: '\uba54\ud2b8\ub9ad \uc0dd\uc131 \uc2e4\ud328',
  })
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
