import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';
import { UgcServiceService } from './ugc-service.service';

@Controller()
export class UgcServiceController {
  constructor(private readonly ugcServiceService: UgcServiceService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.ugcServiceService.getHello();
  }

  // ALB/번들 헬스체크용. 전역 JwtAuthGuard/ScopeGuard 우회 위해 @Public() 필수.
  @Get('health')
  @Public()
  health() {
    return { status: 'ok', service: 'ugc-service', timestamp: new Date().toISOString() };
  }
}
