/**
 * 정책 관리 DTO
 * Controller 레이어에서 사용되는 데이터 전송 객체들
 */

import {
  CreatePolicyRequest,
  UpdatePolicyRequest,
  GetPoliciesQuery,
} from '../../shared/schemas/requests';

// Re-export request types as DTOs for consistency
export type CreatePolicyDto = CreatePolicyRequest;
export type UpdatePolicyDto = UpdatePolicyRequest;
export type GetPoliciesDto = GetPoliciesQuery;

// Additional DTOs specific to policy management
export interface DeactivatePolicyDto {
  reason?: string;
}

export interface PolicyFilterDto {
  ruleTypes?: string[];
  tierIds?: string[];
  isActive?: boolean;
  validAt?: string;
}

export interface PolicyBulkOperationDto {
  policyIds: string[];
  operation: 'activate' | 'deactivate' | 'delete';
  reason?: string;
}

export interface PolicyTemplateDto {
  name: string;
  description?: string;
  category: string;
  templateData: {
    policies: CreatePolicyDto[];
    variables: Record<string, any>;
    conditions: Record<string, any>;
  };
}

export interface ApplyTemplateDto {
  templateId: string;
  variables?: Record<string, any>;
  targetTierIds?: string[];
}

export interface PolicyVersionDto {
  version: number;
  ruleValue: Record<string, any>;
  changeReason?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface RollbackPolicyDto {
  targetVersion: number;
  reason: string;
}