import { Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyGuard } from './policy.guard';
import { SubscriptionModule } from '../subscription/subscription.module'; // SubscriptionService를 사용하기 위해 import

/**
 * 정책 관리 모듈
 * 정책의 CRUD와 검증 로직을 제공합니다.
 */
@Module({
  imports: [
    SubscriptionModule, // PolicyGuard가 SubscriptionService를 사용하므로 해당 모듈을 import 해야합니다.
  ],
  providers: [
    PolicyService,
    PolicyGuard, // Guard도 의존성 주입을 사용하는 Provider이므로 등록해야 합니다.
  ],
  exports: [
    PolicyService,
    PolicyGuard, // 다른 모듈에서 Guard를 사용할 수 있도록 export합니다.
  ],
})
export class PolicyManagementModule {}
