import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'core' };
  }
}
