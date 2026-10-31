import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';
import { TenantFree } from './platform/tenancy/tenant-free.decorator';

@Controller()
export class AppController {
  // ALB 헬스체크 — 토큰·헤더 없이 부르고 DB 를 읽지 않는다.
  @Public()
  @TenantFree()
  @Get('health')
  health() {
    return { status: 'ok', service: 'core' };
  }
}
