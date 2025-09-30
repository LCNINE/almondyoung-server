import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// 요청 스키마들
export const CreateCategorySchema = z.object({
  name: z
    .string()
    .min(1, '카테고리명은 필수입니다')
    .max(255, '카테고리명은 255자 이하여야 합니다')
    .describe('카테고리 이름'),
  description: z.string().optional().describe('카테고리 설명'),
  slug: z.string().optional().describe('URL 슬러그'),
  imageUrl: z
    .string()
    .url('유효한 URL 형식이어야 합니다')
    .optional()
    .describe('카테고리 이미지 URL'),
  parentId: z
    .uuid('유효한 UUID 형식이어야 합니다')
    .optional()
    .describe('부모 카테고리 ID (UUID 형식)'),
  sortOrder: z.number().int().min(0).optional().describe('정렬 순서'),
});

export const UpdateCategorySchema = z.object({
  name: z
    .string()
    .min(1, '카테고리명은 필수입니다')
    .max(255, '카테고리명은 255자 이하여야 합니다')
    .optional()
    .describe('카테고리 이름'),
  description: z.string().optional().describe('카테고리 설명'),
  slug: z.string().optional().describe('URL 슬러그'),
  imageUrl: z
    .string()
    .url('유효한 URL 형식이어야 합니다')
    .optional()
    .describe('카테고리 이미지 URL'),
  sortOrder: z.number().int().min(0).optional().describe('정렬 순서'),
  isActive: z.boolean().optional().describe('활성 상태'),
});

// 응답 스키마들
export const CategoryResponseSchema = z.object({
  id: z.uuid().describe('카테고리 ID (UUID 형식)'),
  name: z.string().describe('카테고리 이름'),
  description: z.string().nullable().describe('카테고리 설명'),
  slug: z.string().nullable().describe('URL 슬러그'),
  imageUrl: z.string().nullable().describe('카테고리 이미지 URL'),
  parentId: z.uuid().nullable().describe('부모 카테고리 ID (UUID 형식)'),
  sortOrder: z.number().int().describe('정렬 순서'),
  isActive: z.boolean().describe('활성 상태'),
  createdAt: z.iso.datetime().describe('생성일시 (ISO 8601 형식)'),
  updatedAt: z.iso.datetime().describe('수정일시 (ISO 8601 형식)'),
});

export const CategoryDetailResponseSchema = z.object({
  id: z.uuid().describe('카테고리 ID (UUID 형식)'),
  name: z.string().describe('카테고리 이름'),
  description: z.string().nullable().describe('카테고리 설명'),
  slug: z.string().nullable().describe('URL 슬러그'),
  imageUrl: z.string().nullable().describe('카테고리 이미지 URL'),
  parentId: z.uuid().nullable().describe('부모 카테고리 ID (UUID 형식)'),
  sortOrder: z.number().int().describe('정렬 순서'),
  isActive: z.boolean().describe('활성 상태'),
  createdAt: z.iso.datetime().describe('생성일시 (ISO 8601 형식)'),
  updatedAt: z.iso.datetime().describe('수정일시 (ISO 8601 형식)'),
  children: z.array(CategoryResponseSchema).describe('하위 카테고리 목록'),
  productCount: z.number().int().min(0).describe('해당 카테고리의 제품 수'),
});

export const CategoryTreeNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.uuid().describe('카테고리 ID (UUID 형식)'),
    name: z.string().describe('카테고리 이름'),
    description: z.string().nullable().describe('카테고리 설명'),
    slug: z.string().nullable().describe('URL 슬러그'),
    imageUrl: z.string().nullable().describe('카테고리 이미지 URL'),
    parentId: z.uuid().nullable().describe('부모 카테고리 ID (UUID 형식)'),
    sortOrder: z.number().int().describe('정렬 순서'),
    isActive: z.boolean().describe('활성 상태'),
    children: z.array(CategoryTreeNodeSchema).describe('하위 카테고리 목록'),
  }),
);

export const CategoryTreeResponseSchema = z.object({
  categories: z.array(CategoryTreeNodeSchema).describe('카테고리 트리'),
  maxDepth: z.number().int().min(0).optional().describe('최대 깊이'),
});

export const CategoryPathResponseSchema = z.object({
  categoryId: z.uuid().describe('카테고리 ID'),
  path: z
    .array(
      z.object({
        id: z.uuid().describe('카테고리 ID'),
        name: z.string().describe('카테고리 이름'),
        slug: z.string().nullable().describe('URL 슬러그'),
      }),
    )
    .describe('루트부터 현재 카테고리까지의 경로'),
  depth: z.number().int().min(0).describe('카테고리 깊이'),
});

// DTO 클래스들
export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(UpdateCategorySchema) {}
export class CategoryResponseDto extends createZodDto(CategoryResponseSchema) {}
export class CategoryDetailResponseDto extends createZodDto(
  CategoryDetailResponseSchema,
) {}
export class CategoryTreeResponseDto extends createZodDto(
  CategoryTreeResponseSchema,
) {}
export class CategoryPathResponseDto extends createZodDto(
  CategoryPathResponseSchema,
) {}
