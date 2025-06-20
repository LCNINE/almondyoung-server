import { Controller, Get } from '@nestjs/common';
import { WmsService } from './wms.service';

@Controller()
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  @Get()
  getHello(): string {
    return this.wmsService.getHello();
  }
}
