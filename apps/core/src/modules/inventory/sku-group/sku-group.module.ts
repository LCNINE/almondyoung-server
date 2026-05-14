import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { SkuGroupController } from './controllers/sku-group.controller';
import { SkuGroupService } from './services/sku-group.service';
import { SkuGroupReader } from './services/sku-group.reader';
import { SkuGroupManager } from './services/sku-group.manager';

@Module({
  imports: [SharedModule],
  controllers: [SkuGroupController],
  providers: [SkuGroupService, SkuGroupReader, SkuGroupManager],
  exports: [SkuGroupService],
})
export class SkuGroupModule {}
