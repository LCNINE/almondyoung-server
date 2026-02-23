import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { ApiWalletOkResponse } from './common/decorators/api-wallet-response.decorator';
import { HealthDataResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('v1')
export class HealthController {
  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Liveness probe endpoint for wallet service.',
  })
  @ApiWalletOkResponse(HealthDataResponseDto, {
    description: 'Wallet service is alive',
  })
  health() {
    return {
      success: true,
      data: { status: 'ok' },
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness check',
    description: 'Readiness probe endpoint for wallet service.',
  })
  @ApiWalletOkResponse(HealthDataResponseDto, {
    description: 'Wallet service is ready',
  })
  ready() {
    return {
      success: true,
      data: { status: 'ready' },
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
