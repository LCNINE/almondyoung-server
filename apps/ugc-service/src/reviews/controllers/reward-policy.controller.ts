import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { ReviewRewardPolicyService } from '../services/review-reward-policy.service';

@ApiTags('Reviews')
@Controller('reviews')
export class RewardPolicyController {
  constructor(private readonly rewardPolicyService: ReviewRewardPolicyService) {}

  @Get('reward-policies')
  @Public()
  @ApiOperation({ summary: '리뷰 리워드 정책 조회' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '활성 리워드 정책 목록',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reviewType: { type: 'string', enum: ['TEXT', 'PHOTO'] },
          rewardAmount: { type: 'number', example: 100 },
          minContentLength: { type: 'number', example: 10 },
          minMediaCount: { type: 'number', example: 0 },
        },
      },
    },
  })
  async getActivePolicies() {
    return this.rewardPolicyService.getActivePolicies();
  }
}
