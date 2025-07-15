import { Module } from '@nestjs/common';

import { BatchCmsMockHmsApiProvider } from '../payment-method/hms-provider';
@Module({
  imports: [],
  controllers: [],
  providers: [BatchCmsMockHmsApiProvider],
  exports: [],
})
export class AccountMethodModule {}
