import { Controller, Get } from '@nestjs/common';
import { UserMainService } from './user-main.service';

@Controller()
export class UserMainController {
  constructor(private readonly userMainService: UserMainService) {}

  @Get()
  getHello(): string {
    return this.userMainService.getHello();
  }
}
