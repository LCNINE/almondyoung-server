import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller()
export class HealthController {
  @Get('health')
  @ApiOperation({ summary: '서비스 상태 확인' })
  @ApiResponse({ status: 200, description: '서비스 정상' })
  getHealth() {
    return {
      status: 'ok',
      service: 'channel-adapter',
      timestamp: new Date().toISOString(),
    };
  }
}
