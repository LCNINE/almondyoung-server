import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/authorization';
import { UgcServiceService } from './ugc-service.service';

@Controller()
export class UgcServiceController {
  constructor(private readonly ugcServiceService: UgcServiceService) { }

  @Get()
  @Public()
  getHello(): string {
    return this.ugcServiceService.getHello();
  }
}
