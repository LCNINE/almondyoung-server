import { Controller, Get } from '@nestjs/common';
import { UgcServiceService } from './ugc-service.service';

@Controller()
export class UgcServiceController {
  constructor(private readonly ugcServiceService: UgcServiceService) { }

  @Get()
  getHello(): string {
    return this.ugcServiceService.getHello();
  }
}
