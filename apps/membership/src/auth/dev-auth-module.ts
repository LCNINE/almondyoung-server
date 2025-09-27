import { Module } from '@nestjs/common';
import { DevAuthGuard } from './dev-auth.guard';

@Module({
  providers: [DevAuthGuard], // 👈 여기에 등록
  exports: [DevAuthGuard], // 👈 여기에 등록
})
export class DevAuthModule {}
