import { Module } from '@nestjs/common';
import { DatabaseModule } from 'apps/user-service/database/database.module';
import { RecentViewsController } from './recent-views.controller';
import { RecentViewsService } from './recent-views.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RecentViewsController],
  providers: [RecentViewsService],
})
export class RecentViewsModule {}
