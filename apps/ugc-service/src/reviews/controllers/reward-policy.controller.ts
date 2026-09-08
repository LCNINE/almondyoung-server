import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { ReviewRewardRuleService } from '../rewards/review-reward-rule.service';
import { toPublicGuides } from '../rewards/reward-rule.evaluator';

@ApiTags('Reviews')
@Controller('reviews')
export class RewardPolicyController {
  constructor(private readonly ruleService: ReviewRewardRuleService) {}

  /**
   * 고객 화면이 「리뷰를 쓰면 무엇을 받는지」 안내할 때 쓰는 요약.
   * 활성 규칙이 없으면 빈 배열이고, 그때 스토어프론트는 적립 문구를 아예 띄우지 않는다.
   */
  @Get('reward-policies')
  @Public()
  @ApiOperation({ summary: '리뷰 보상 안내 (활성 규칙에서 파생)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '활성 보상 안내. 활성 규칙이 없으면 빈 배열',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reviewType: { type: 'string', enum: ['TEXT', 'PHOTO'] },
          rewardKind: { type: 'string', enum: ['POINT_FIXED', 'POINT_RATE', 'BADGE'] },
          rewardAmount: { type: 'number', example: 100 },
          ratePercent: { type: 'number', nullable: true, example: 5 },
          maxAmount: { type: 'number', nullable: true, example: 500 },
          minContentLength: { type: 'number', example: 10 },
          minMediaCount: { type: 'number', example: 0 },
          expiresInDays: { type: 'number', nullable: true, example: 90 },
        },
      },
    },
  })
  async getActivePolicies() {
    const rules = await this.ruleService.getActiveRules('ON_REVIEW_CREATED');
    return toPublicGuides(rules, new Date());
  }
}
