import { Module } from '@nestjs/common';
import { FileOwnerClient } from './clients/file-owner.client';
import { LogoContestController } from './controllers/logo-contest.controller';
import { LogoContestPeriodService } from './services/logo-contest-period.service';
import { LogoContestService } from './services/logo-contest.service';

@Module({
  controllers: [LogoContestController],
  providers: [LogoContestService, LogoContestPeriodService, FileOwnerClient],
})
export class LogoContestModule {}
