import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';

@Controller('v1')
export class HealthController {
  @Public()
  @Get('health')
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
  ready() {
    return {
      success: true,
      data: { status: 'ready' },
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
