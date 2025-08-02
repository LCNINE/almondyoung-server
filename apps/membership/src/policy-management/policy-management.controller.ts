import { Controller, Get, Post, Put, Delete, Param, Body, Query, UsePipes } from '@nestjs/common';
import { PolicyManagementService } from './policy-management.service';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  GetPoliciesDto,
  CreatePolicyRequestSchema,
  UpdatePolicyRequestSchema,
  GetPoliciesQuerySchema,
} from './dto';
import type {
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyResponse,
} from '../shared/schemas/types';

/**
 * 정책 관리 컨트롤러
 * 정책의 CRUD 작업을 위한 REST API를 제공합니다.
 */
@Controller('policies')
export class PolicyManagementController {
  constructor(private readonly policyManagementService: PolicyManagementService) {}

  /**
   * 모든 정책을 조회합니다.
   */
  @Get()
  @UsePipes(new ZodValidationPipe(GetPoliciesQuerySchema))
  async getAllPolicies(@Query() query: GetPoliciesDto): Promise<PolicyResponse[]> {
    return this.policyManagementService.getAllPolicies(query);
  }

  /**
   * 특정 정책을 조회합니다.
   */
  @Get(':policyId')
  async getPolicyById(@Param('policyId') policyId: string): Promise<PolicyResponse | null> {
    return this.policyManagementService.getPolicyById(policyId);
  }

  /**
   * 새로운 정책을 생성합니다.
   */
  @Post()
  @UsePipes(new ZodValidationPipe(CreatePolicyRequestSchema))
  async createPolicy(@Body() createPolicyDto: CreatePolicyDto): Promise<PolicyResponse | null> {
    return this.policyManagementService.createPolicy(createPolicyDto);
  }

  /**
   * 기존 정책을 업데이트합니다.
   */
  @Put(':policyId')
  @UsePipes(new ZodValidationPipe(UpdatePolicyRequestSchema))
  async updatePolicy(
    @Param('policyId') policyId: string,
    @Body() updatePolicyDto: UpdatePolicyDto,
  ): Promise<PolicyResponse | null> {
    return this.policyManagementService.updatePolicy(policyId, updatePolicyDto);
  }

  /**
   * 정책을 비활성화합니다.
   */
  @Delete(':policyId')
  async deactivatePolicy(
    @Param('policyId') policyId: string,
  ): Promise<{ success: boolean; message: string } | null> {
    return this.policyManagementService.deactivatePolicy(policyId);
  }
}