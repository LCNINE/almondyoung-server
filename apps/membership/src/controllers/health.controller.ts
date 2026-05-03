import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
