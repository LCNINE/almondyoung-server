import { Module } from '@nestjs/common';
import { UserMainController } from './user-main.controller';
import { UserMainService } from './user-main.service';

@Module({
  controllers: [UserMainController],
  providers: [UserMainService],
})
export class UserMainModule {}
