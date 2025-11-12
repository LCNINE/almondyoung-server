import { Module } from '@nestjs/common';
import { RecentViewsController } from './recent-views.controller';
import { RecentViewsService } from './recent-views.service';

@Module({
  imports: [],
  controllers: [RecentViewsController],
  providers: [RecentViewsService],
})
export class RecentViewsModule {}
