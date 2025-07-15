import { Controller, Get, Query } from '@nestjs/common';
import { AccountMethodService } from './account-method.service';

@Controller('account-method')
export class AccountMethodController {
  constructor(private readonly accountMethodService: AccountMethodService) {}

  @Get()
  async getList(@Query('userId') userId: number) {
    return this.accountMethodService.getList(userId);
  }
    }