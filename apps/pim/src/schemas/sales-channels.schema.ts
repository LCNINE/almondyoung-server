import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// 기본 스키마들
const ChannelTypeSchema = z
  .enum([
    'ONLINE',
    'OFFLINE',
    'MARKETPLACE',
    'MOBILE_APP',
    'SOCIAL_COMMERCE',
  ] as const)
  .describe('판매 채널 타입');

// 요청 스키마들
export const CreateSalesChannelSchema = z.object({
  type: ChannelTypeSchema.describe('판매 채널 타입'),
  name: z
    .string()
    .min(1, '채널명은 필수입니다')
    .max(255, '채널명은 255자 이하여야 합니다')
    .describe('판매 채널 이름'),
  description: z.string().optional().describe('채널 설명'),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('채널별 설정 정보'),
  isActive: z.boolean().default(true).describe('활성 상태'),
  apiEndpoint: z
    .string()
    .url('유효한 URL이어야 합니다')
    .optional()
    .describe('API 엔드포인트 URL'),
  credentials: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('인증 정보'),
});

export const UpdateSalesChannelSchema = z.object({
  name: z
    .string()
    .min(1, '채널명은 필수입니다')
    .max(255, '채널명은 255자 이하여야 합니다')
    .optional()
    .describe('판매 채널 이름'),
  description: z.string().optional().describe('채널 설명'),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('채널별 설정 정보'),
  isActive: z.boolean().optional().describe('활성 상태'),
  apiEndpoint: z
    .string()
    .url('유효한 URL이어야 합니다')
    .optional()
    .describe('API 엔드포인트 URL'),
  credentials: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('인증 정보'),
});

export const SetChannelActiveSchema = z.object({
  isActive: z.boolean().describe('활성 여부'),
});

export const ValidateChannelConfigSchema = z.object({
  type: ChannelTypeSchema.describe('채널 타입'),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('검증할 채널 설정 데이터'),
});

// 응답 스키마들
export const SalesChannelSchema = z.object({
  id: z.uuid().describe('판매 채널 ID (UUID 형식)'),
  type: ChannelTypeSchema.describe('판매 채널 타입'),
  name: z.string().describe('판매 채널 이름'),
  description: z.string().nullable().describe('채널 설명'),
  config: z.record(z.string(), z.unknown()).describe('채널별 설정 정보'),
  isActive: z.boolean().describe('활성 상태'),
  apiEndpoint: z.string().nullable().describe('API 엔드포인트 URL'),
  credentials: z.record(z.string(), z.unknown()).describe('인증 정보'),
  createdAt: z.iso.datetime().describe('생성일시 (ISO 8601 형식)'),
  updatedAt: z.iso.datetime().describe('수정일시 (ISO 8601 형식)'),
});

export const ChannelListResponseSchema = z.object({
  data: z.array(SalesChannelSchema).describe('판매 채널 목록'),
  total: z.number().int().min(0).describe('전체 아이템 수'),
  page: z.number().int().min(1).describe('현재 페이지 번호'),
  limit: z.number().int().min(1).describe('페이지당 아이템 수'),
});

export const ChannelValidationResponseSchema = z.object({
  isValid: z.boolean().describe('설정 유효성 여부'),
  errors: z.array(z.string()).describe('검증 오류 목록'),
});

// DTO 클래스들
export class NewSalesChannelDto extends createZodDto(
  CreateSalesChannelSchema,
) {}
export class UpdateSalesChannelDto extends createZodDto(
  UpdateSalesChannelSchema,
) {}
export class SetChannelActiveDto extends createZodDto(SetChannelActiveSchema) {}
export class ValidateChannelConfigDto extends createZodDto(
  ValidateChannelConfigSchema,
) {}
export class SalesChannelDto extends createZodDto(SalesChannelSchema) {}
export class ChannelListResponseDto extends createZodDto(
  ChannelListResponseSchema,
) {}
export class ChannelValidationResponseDto extends createZodDto(
  ChannelValidationResponseSchema,
) {}
