import { Module } from '@nestjs/common';
import { ReviewEligibilityController } from './review-eligibility.controller';
import { ReviewPermissionService } from './review-permission.service';

/**
 * 리뷰를 쓸 «권한»을 소유하는 모듈. 리뷰 모듈이 이쪽에 물어보고, 반대 방향 의존은 없다.
 */
@Module({
  controllers: [ReviewEligibilityController],
  providers: [ReviewPermissionService],
  exports: [ReviewPermissionService],
})
export class ReviewPermissionsModule {}
