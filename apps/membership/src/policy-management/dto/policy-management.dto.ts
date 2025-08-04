/**
 * 정책 관리 DTO (nestjs-zod 기반)
 */

import { CreatePolicyRequest } from '../../shared/schemas';

// nestjs-zod로 DTO 생성 - 기본 검증 포함

// Additional DTOs for policy management
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
    policies: CreatePolicyRequest[];
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
