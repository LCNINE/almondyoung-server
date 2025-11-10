import { Get } from '@nestjs/common';
import { UserMainService } from './user-main.service';

export class UserMainController {
  constructor(private readonly userMainService: UserMainService) {}

  @Get()
  getHello(): string {
    return this.userMainService.getHello();
  }
}
