import { Controller, Get } from '@nestjs/common';

@Controller()
export class PimController {
  @Get('health')
  getHealthCheck(): { status: string; service: string } {
    return {
      status: 'ok',
      service: 'PIM (Product Information Management)'
    };
  }
}
