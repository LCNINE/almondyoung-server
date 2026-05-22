import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@app/authorization';
import { SharedModule } from '../shared/shared.module';
import { FileAccess } from './file-access';

@Module({
  imports: [AuthorizationModule, SharedModule],
  providers: [FileAccess],
  exports: [FileAccess],
})
export class FileAccessModule {}
