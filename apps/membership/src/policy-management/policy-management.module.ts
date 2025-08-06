import { Module } from '@nestjs/common';
import { PolicyManagementService } from './policy-management.service';
import { PolicyEngineService } from './policy-engine.service';
import { UserPolicyController } from './user-policy.controller';

/**
 * 정책 관리 모듈
 * 정책 엔진과 사용자용 정책 조회 API를 제공합니다.
 * 관리자용 정책 관리는 AdminOperationsModule에서 처리합니다.
 */
@Module({
  imports: [],
  controllers: [UserPolicyController],
  providers: [PolicyManagementService, PolicyEngineService],
  exports: [PolicyManagementService, PolicyEngineService],
})
export class PolicyManagementModule {}
