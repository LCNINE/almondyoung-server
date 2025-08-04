import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PolicyEngineService } from './policy-engine.service';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';

import {
  PolicyValidationRequestSchema,
  BulkPolicyValidationRequestSchema,
  GetApplicablePoliciesQuerySchema,
  PolicyValidationRequest,
  BulkPolicyValidationRequest,
  GetApplicablePoliciesQuery,
} from '../shared/schemas/requests';
import type {
  PolicyValidationResult,
  PolicyResponse,
} from '../shared/schemas/types';

/**
 * 정책 검증 컨트롤러
 * 정책 검증 및 조회를 위한 REST API를 제공합니다.
 */
@ApiTags('policies')
@Controller('policies/validation')
export class PolicyValidationController {
  constructor(private readonly policyEngineService: PolicyEngineService) {}

  /**
   * 정책 준수 여부를 검증합니다.
   */
  @Post('validate')
  @ApiOperation({ summary: '정책 준수 검증' })
  @UsePipes(new ZodValidationPipe(PolicyValidationRequestSchema))
  async validatePolicyCompliance(
    @Body() validationDto: PolicyValidationRequest,
  ): Promise<PolicyValidationResult> {
    const { userId, action, context, policyIds } = validationDto;
    return this.policyEngineService.validateRequest(
      userId,
      action,
      context,
      policyIds,
    );
  }

  /**
   * 여러 요청을 한 번에 검증합니다.
   */
  @Post('validate/bulk')
  @ApiOperation({ summary: '벌크 정책 검증' })
  @UsePipes(new ZodValidationPipe(BulkPolicyValidationRequestSchema))
  async bulkValidatePolicies(
    @Body() bulkValidationDto: BulkPolicyValidationRequest,
  ): Promise<{
    results: PolicyValidationResult[];
    totalExecutionTime: number;
  }> {
    const { requests } = bulkValidationDto;
    const results: PolicyValidationResult[] = [];

    for (const request of requests) {
      const result = await this.policyEngineService.validateRequest(
        request.userId,
        request.action,
        request.context,
        request.policyIds,
      );
      results.push(result);
    }

    return {
      results,
      totalExecutionTime: results.reduce((sum, r) => sum + r.executionTime, 0),
    };
  }

  /**
   * 사용자에게 적용 가능한 정책들을 조회합니다.
   */
  @Get('user/:userId/applicable')
  @ApiOperation({ summary: '사용자별 적용 가능한 정책 조회' })
  @UsePipes(new ZodValidationPipe(GetApplicablePoliciesQuerySchema))
  async getApplicablePolicies(
    @Param('userId') userId: string,
    @Query() context: GetApplicablePoliciesQuery,
  ): Promise<PolicyResponse[]> {
    return this.policyEngineService.getApplicablePolicies(userId, context);
  }
}
