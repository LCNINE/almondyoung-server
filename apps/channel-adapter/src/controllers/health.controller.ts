import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';

@ApiTags('Health')
@Controller()
export class HealthController {
  // ALB 타깃그룹 헬스체크 경로. 인증을 걸면 태스크가 unhealthy 로 빠진다.
  @Public()
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
