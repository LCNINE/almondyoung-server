// policy.module.ts
import { Module } from '@nestjs/common';
import { PolicyManagementService } from './policy-management.service';
import { PolicyValidationService } from './policy-validation.service';
import { PolicyGuard } from './policy.guard';

@Module({
  imports: [
    // DbModule 등 필요한 모듈
  ],
  providers: [PolicyManagementService, PolicyValidationService, PolicyGuard],
  controllers: [],
  exports: [
    PolicyManagementService, // 관리자 모듈에서 사용
    PolicyValidationService, // SubscriptionModule, Guard에서 사용
    PolicyGuard, // 컨트롤러에서 사용
  ],
})
export class PolicyManagementModule {}
