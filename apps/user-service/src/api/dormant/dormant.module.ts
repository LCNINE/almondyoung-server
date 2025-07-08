import { Module } from '@nestjs/common';
import { DormantController } from './dormant.controller';
import { DormantService } from './dormant.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [DormantController],
  providers: [DormantService],
})
export class DormantModule {}
