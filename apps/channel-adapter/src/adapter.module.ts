import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NaverSmartstoreStrategy } from './services/strategies/naver-smartstore.strategy';
import { CoupangStrategy } from './services/strategies/coupang.strategy';
import { ChannelStrategyFactory } from './services/strategies/channel-strategy.factory';
import { AdapterOrchestrationService } from './services/adapter-orchestration.service';
import { SyncStatusService } from './services/sync-status.service';
import { ChannelAdapterController } from './controllers/channel-adapter.controller';
import { SyncStatusController } from './controllers/sync-status.controller';
import { ChannelAdapterService } from './services/channel-adapter.service';
import { NaverCommerceApiService } from './services/apis/naver-commerce.api.service';
import { DbModule } from '@app/db';

@Module({
  imports: [HttpModule, DbModule],
  controllers: [ChannelAdapterController, SyncStatusController],
  providers: [
    ChannelAdapterService,
    AdapterOrchestrationService,
    SyncStatusService,
    ChannelStrategyFactory,
    NaverSmartstoreStrategy,
    CoupangStrategy,
    NaverCommerceApiService,
  ],
})
export class AdapterModule {}
