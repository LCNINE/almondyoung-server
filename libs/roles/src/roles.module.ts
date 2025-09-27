import { Module } from '@nestjs/common';
import { AuthorizationGuard } from './guards/authorization-guard';

@Module({
  providers: [AuthorizationGuard],
  exports: [AuthorizationGuard],
})
export class RolesModule {}
