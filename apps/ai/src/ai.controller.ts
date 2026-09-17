import { Public } from '@app/authorization';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AiController {
  @Get('health')
  @Public()
  health() {
    return { status: 'ok', service: 'ai', timestamp: new Date().toISOString() };
  }
}
