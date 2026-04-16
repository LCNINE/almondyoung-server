import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { HealthService } from '../services/health.service';

@ApiTags('Health')
@Controller('inventory/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: '\uc804\uccb4 \ud5ec\uc2a4\uccb4\ud06c',
    description: 'WMS \uc11c\ube44\uc2a4\uc758 \uc804\uccb4 \uc0c1\ud0dc\ub97c \ud655\uc778\ud569\ub2c8\ub2e4.',
  })
  @ApiResponse({ status: 200, description: '\uc11c\ube44\uc2a4 \uc815\uc0c1' })
  @ApiResponse({ status: 503, description: '\uc11c\ube44\uc2a4 \ube44\uc815\uc0c1' })
  async getHealth() {
    return this.healthService.checkHealth();
  }

  @Get('ready')
  @ApiOperation({
    summary: '\uc900\ube44\uc0c1\ud0dc \ud655\uc778',
    description:
      '\uc11c\ube44\uc2a4\uac00 \uc694\uccad\uc744 \ubc1b\uc744 \uc900\ube44\uac00 \ub418\uc5c8\ub294\uc9c0 \ud655\uc778\ud569\ub2c8\ub2e4.',
  })
  @ApiResponse({ status: 200, description: '\uc11c\ube44\uc2a4 \uc900\ube44 \uc644\ub8cc' })
  @ApiResponse({ status: 503, description: '\uc11c\ube44\uc2a4 \uc900\ube44 \ubbf8\uc644\ub8cc' })
  async getReadiness() {
    return this.healthService.checkReadiness();
  }

  @Get('live')
  @ApiOperation({
    summary: '\uc0dd\uc874\uc0c1\ud0dc \ud655\uc778',
    description: '\uc11c\ube44\uc2a4\uac00 \uc0b4\uc544\uc788\ub294\uc9c0 \ud655\uc778\ud569\ub2c8\ub2e4.',
  })
  @ApiResponse({ status: 200, description: '\uc11c\ube44\uc2a4 \uc0dd\uc874' })
  @ApiResponse({ status: 503, description: '\uc11c\ube44\uc2a4 \ube44\uc0dd\uc874' })
  async getLiveness() {
    return this.healthService.checkLiveness();
  }

  @Get('detailed')
  @ApiOperation({
    summary: '\uc0c1\uc138 \ud5ec\uc2a4\uccb4\ud06c',
    description:
      '\uc11c\ube44\uc2a4\uc758 \uc0c1\uc138\ud55c \uc0c1\ud0dc \uc815\ubcf4\ub97c \ud655\uc778\ud569\ub2c8\ub2e4.',
  })
  @ApiResponse({ status: 200, description: '\uc0c1\uc138 \uc0c1\ud0dc \uc815\ubcf4 \uc870\ud68c \uc131\uacf5' })
  async getDetailedHealth() {
    return this.healthService.getDetailedHealth();
  }
}
