import { Module } from '@nestjs/common';
import { LifecycleController } from './lifecycle.controller';
import { FileAccessModule } from '../access/file-access.module';

@Module({
  imports: [FileAccessModule],
  controllers: [LifecycleController],
})
export class LifecycleModule {}
