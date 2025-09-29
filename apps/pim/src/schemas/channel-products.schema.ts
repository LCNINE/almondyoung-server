import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// 공통 헬퍼
const UUID = z.string().uuid();

// 요청 스키마들 (그대로)
export const CreateChannelProductSchema = z.object({
  masterId: UUID.describe('제품 마스터 ID (UUID 형식)'),
  channelId: UUID.describe('판매 채널 ID (UUID 형식)'),
  name: z
    .string()
    .optional()
    .describe('채널별 제품명 (미지정시 마스터명 사용)'),
  description: z.string().optional().describe('채널별 제품 설명'),
  images: z
    .array(z.string().url('유효한 URL이어야 합니다'))
    .optional()
    .describe('채널별 제품 이미지 URL 배열'),
  isActive: z.boolean().default(true).describe('채널에서의 활성 상태'),
  channelSpecificData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('채널별 특화 데이터'),
});

export const UpdateChannelProductSchema = z.object({
  name: z.string().max(255).optional().describe('채널별 제품명'),
  isActive: z.boolean().optional().describe('채널에서의 활성 상태'),
  channelSpecificData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('채널별 특화 데이터'),
});

export const OverrideProductNameSchema = z.object({
  name: z.string().min(1, '제품명은 필수입니다').describe('새로운 제품 이름'),
});

export const SetChannelProductActiveSchema = z.object({
  isActive: z.boolean().describe('활성 여부'),
});

// 응답 스키마들 (날짜 → Date 타입)
export const ChannelProductSchema = z.object({
  id: UUID.describe('채널 제품 ID'),
  masterId: UUID.describe('제품 마스터 ID'),
  channelId: UUID.describe('판매 채널 ID'),
  name: z.string().nullable().describe('채널별 제품명'),
  isActive: z.boolean().nullable().describe('채널에서의 활성 상태'),
  channelSpecificData: z.unknown().describe('채널별 특화 데이터'),
  createdAt: z.iso.datetime().nullable().describe('생성일시 (ISO 8601)'),
  updatedAt: z.iso.datetime().nullable().describe('수정일시 (ISO 8601)'),
});

export const ChannelProductWithChannelSchema = z.object({
  id: UUID.describe('채널 제품 ID (UUID 형식)'),
  masterId: UUID.describe('제품 마스터 ID (UUID 형식)'),
  channelId: UUID.describe('판매 채널 ID (UUID 형식)'),
  name: z.string().nullable().describe('채널별 제품명'),
  description: z.string().nullable().describe('채널별 제품 설명'),
  images: z.array(z.string()).describe('채널별 제품 이미지 URL 배열'),
  isActive: z.boolean().describe('채널에서의 활성 상태'),
  channelSpecificData: z
    .record(z.string(), z.unknown())
    .describe('채널별 특화 데이터'),
  createdAt: z.iso.datetime().describe('생성일시'),
  updatedAt: z.iso.datetime().describe('수정일시'),
  channel: z
    .object({
      id: UUID.describe('채널 ID'),
      name: z.string().describe('채널명'),
      type: z.string().describe('채널 타입'),
      isActive: z.boolean().describe('채널 활성 상태'),
    })
    .describe('판매 채널 정보'),
});

export const ChannelProductWithMasterSchema = z.object({
  id: UUID.describe('채널 제품 ID (UUID 형식)'),
  masterId: UUID.describe('제품 마스터 ID (UUID 형식)'),
  channelId: UUID.describe('판매 채널 ID (UUID 형식)'),
  name: z.string().nullable().describe('채널별 제품명'),
  description: z.string().nullable().describe('채널별 제품 설명'),
  images: z.array(z.string()).describe('채널별 제품 이미지 URL 배열'),
  isActive: z.boolean().describe('채널에서의 활성 상태'),
  channelSpecificData: z
    .record(z.string(), z.unknown())
    .describe('채널별 특화 데이터'),
  createdAt: z.iso.datetime().describe('생성일시'),
  updatedAt: z.iso.datetime().describe('수정일시'),
  master: z
    .object({
      id: UUID.describe('마스터 ID'),
      name: z.string().describe('마스터 제품명'),
      brand: z.string().nullable().describe('브랜드명'),
      basePrice: z.number().describe('기본 가격'),
      status: z.string().describe('마스터 상태'),
    })
    .describe('제품 마스터 정보'),
});

export const ChannelProductListResponseSchema = z.object({
  data: z.array(ChannelProductWithMasterSchema).describe('채널 제품 목록'),
  total: z.number().int().min(0).describe('전체 아이템 수'),
  page: z.number().int().min(1).describe('현재 페이지 번호'),
  limit: z.number().int().min(1).describe('페이지당 아이템 수'),
});

export const MergedChannelProductSchema = z.object({
  id: UUID.describe('채널 제품 ID'),
  masterId: UUID.describe('제품 마스터 ID'),
  channelId: UUID.describe('판매 채널 ID'),
  name: z.string().describe('제품명 (채널별 또는 마스터)'),
  description: z.string().describe('제품 설명 (채널별 또는 마스터)'),
  images: z.array(z.string()).describe('제품 이미지 URL 배열'),
  isActive: z.boolean().describe('활성 상태'),
  basePrice: z.number().describe('기본 가격'),
  channelSpecificData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('채널별 특화 데이터'),
});

// DTO 클래스들
export class CreateChannelProductDto extends createZodDto(
  CreateChannelProductSchema,
) {}
export class UpdateChannelProductDto extends createZodDto(
  UpdateChannelProductSchema,
) {}
export class OverrideProductNameDto extends createZodDto(
  OverrideProductNameSchema,
) {}
export class SetChannelProductActiveDto extends createZodDto(
  SetChannelProductActiveSchema,
) {}
export class ChannelProductDto extends createZodDto(ChannelProductSchema) {}
export class ChannelProductWithChannelDto extends createZodDto(
  ChannelProductWithChannelSchema,
) {}
export class ChannelProductWithMasterDto extends createZodDto(
  ChannelProductWithMasterSchema,
) {}
export class ChannelProductListResponseDto extends createZodDto(
  ChannelProductListResponseSchema,
) {}
export class MergedChannelProductDto extends createZodDto(
  MergedChannelProductSchema,
) {}
