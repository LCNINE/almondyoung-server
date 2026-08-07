import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';

@Controller()
export class HealthController {
  // ALB 타깃그룹 헬스체크가 토큰 없이 부르는 경로다 (deployments/.../shared.ts, path '/health').
  // 인증을 요구하면 태스크가 unhealthy 로 빠져 서비스가 통째로 내려간다.
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'notification',
      timestamp: new Date().toISOString(),
    };
  }
}
