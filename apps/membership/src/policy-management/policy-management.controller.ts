import { Controller, Get, Post, Put, Delete, Param, Body, Query, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { PolicyManagementService } from './policy-management.service';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  GetPoliciesDto,
} from './dto/policy-management.dto';
import { UpdatePolicyRequestSchema } from '../shared/schemas/requests';
import type {
  PolicyResponse,
  PolicyListResponse,
} from '../shared/schemas/types';

/**
 * 정책 관리 컨트롤러
 * 정책의 CRUD 작업을 위한 REST API를 제공합니다.
 */
@ApiTags('policies')
@Controller('policies')
export class PolicyManagementController {
  constructor(private readonly policyManagementService: PolicyManagementService) {}

  /**
   * 모든 정책을 조회합니다.
   */
  @Get()
  @ApiOperation({ summary: '정책 목록 조회' })
  async getAllPolicies(@Query() query: GetPoliciesDto): Promise<PolicyListResponse> {
    return this.policyManagementService.getAllPolicies(query);
  }

  /**
   * 특정 정책을 조회합니다.
   */
  @Get(':policyId')
  @ApiOperation({ summary: '특정 정책 조회' })
  async getPolicyById(@Param('policyId') policyId: string): Promise<PolicyResponse | null> {
    return this.policyManagementService.getPolicyById(policyId);
  }

  /**
   * 새로운 정책을 생성합니다.
   */
  @Post()
  @ApiOperation({ summary: '새 정책 생성' })
  async createPolicy(@Body() createPolicyDto: CreatePolicyDto): Promise<PolicyResponse | null> {
    return this.policyManagementService.createPolicy(createPolicyDto);
  }

  /**
   * 기존 정책을 업데이트합니다.
   */
  @Put(':policyId')
  @ApiOperation({ summary: '정책 업데이트' })
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
  @ApiOperation({ summary: '정책 비활성화' })
  async deactivatePolicy(
    @Param('policyId') policyId: string,
  ): Promise<{ success: boolean; message: string } | null> {
    return this.policyManagementService.deactivatePolicy(policyId);
  }
}