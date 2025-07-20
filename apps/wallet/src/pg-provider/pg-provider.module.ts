import { Module } from '@nestjs/common';
import { BatchCmsAdapter } from './adapters/batch-cms.adapter';

@Module({
  providers: [BatchCmsAdapter],
  exports: [BatchCmsAdapter],
})
export class PgProviderModule {}
