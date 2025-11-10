import { Controller, Get } from '@nestjs/common';
import { Public } from '../constants/public.decorator';
import { UserMainService } from './user-main.service';

@Controller()
export class UserMainController {
  constructor(private readonly userMainService: UserMainService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.userMainService.getHello();
  }
}
