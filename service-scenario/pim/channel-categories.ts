import { z } from 'zod';
import type { Scenario } from '../types.ts';

/**
 * 채널 분류 (Channel Categories) 시나리오
 *
 * 테스트 범위:
 * - POST /channels/categories (채널 분류 생성)
 * - GET /channels/categories (채널 분류 목록 조회)
 * - GET /channels/categories/:id (채널 분류 상세 조회)
 * - PUT /channels/categories/:id (채널 분류 수정)
 * - DELETE /channels/categories/:id (채널 분류 삭제)
 */

export const channelCategoryScenarios: Scenario[] = [
  // ========================================
  // Group 1: 기본 CRUD 테스트
  // ========================================
  {
    id: 'CHAN-CAT-001',
    name: '채널 분류 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Channel Categories',
    validation: '채널 분류 전체 CRUD 플로우 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/channels/categories',
        service: 'pim',
        body: {
          name: 'Test Category {{timestamp}}',
          description: '테스트 분류',
          displayOrder: 10,
        },
        expectedStatus: 201,
        description: '채널 분류 생성',
        extractFromResponse: { categoryId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          description: z.string().nullable(),
          displayOrder: z.number(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
      },
      {
        id: 'get-category',
        method: 'GET',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '생성된 분류 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          displayOrder: z.literal(10),
        }),
      },
      {
        id: 'update-category',
        method: 'PUT',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        body: {
          name: 'Updated Category {{timestamp}}',
          description: '수정된 설명',
          displayOrder: 20,
        },
        expectedStatus: 200,
        description: '분류 정보 수정',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          displayOrder: z.literal(20),
        }),
      },
      {
        id: 'delete-category',
        method: 'DELETE',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '분류 삭제',
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        expectedStatus: 404,
        description: '삭제된 분류 조회 (404 예상)',
      },
    ],
  },

  // ========================================
  // Group 2: 목록 조회 및 정렬
  // ========================================
  {
    id: 'CHAN-CAT-002',
    name: '채널 분류 목록 조회 및 정렬 순서',
    category: 'PIM > Channel Categories',
    validation: '분류 목록이 displayOrder 기준으로 정렬되는지 확인',
    steps: [
      {
        id: 'create-category-1',
        method: 'POST',
        path: '/channels/categories',
        service: 'pim',
        body: {
          name: 'Category A {{timestamp}}',
          displayOrder: 30,
        },
        expectedStatus: 201,
        description: '분류 1 생성 (displayOrder: 30)',
        extractFromResponse: { category1Id: 'id' },
      },
      {
        id: 'create-category-2',
        method: 'POST',
        path: '/channels/categories',
        service: 'pim',
        body: {
          name: 'Category B {{timestamp}}',
          displayOrder: 10,
        },
        expectedStatus: 201,
        description: '분류 2 생성 (displayOrder: 10)',
        extractFromResponse: { category2Id: 'id' },
      },
      {
        id: 'create-category-3',
        method: 'POST',
        path: '/channels/categories',
        service: 'pim',
        body: {
          name: 'Category C {{timestamp}}',
          displayOrder: 20,
        },
        expectedStatus: 201,
        description: '분류 3 생성 (displayOrder: 20)',
        extractFromResponse: { category3Id: 'id' },
      },
      {
        id: 'list-categories',
        method: 'GET',
        path: '/channels/categories',
        service: 'pim',
        expectedStatus: 200,
        description: '분류 목록 조회 (정렬 확인)',
        responseSchema: z.object({
          data: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              displayOrder: z.number(),
              channelCount: z.number().optional(),
            }),
          ),
        }),
      },
    ],
  },

  // ========================================
  // Group 3: 삭제 제약 조건 테스트
  // ========================================
  {
    id: 'CHAN-CAT-003',
    name: '연결된 채널이 있는 분류 삭제 시도 (409 예상)',
    category: 'PIM > Channel Categories',
    validation: '채널이 연결된 분류는 삭제할 수 없음을 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/channels/categories',
        service: 'pim',
        body: {
          name: 'Category with Channels {{timestamp}}',
          description: '채널이 연결될 분류',
        },
        expectedStatus: 201,
        description: '채널 분류 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        service: 'pim',
        body: {
          name: 'Test Channel {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
          categoryId: '{{categoryId}}',
        },
        expectedStatus: 201,
        description: '분류에 연결된 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'verify-category-with-channels',
        method: 'GET',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '채널이 연결된 분류 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          channelCount: z.number().min(1),
        }),
      },
      {
        id: 'try-delete-category',
        method: 'DELETE',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        expectedStatus: 409,
        description: '채널이 있는 분류 삭제 시도 (409 예상)',
      },
      {
        id: 'delete-channel',
        method: 'DELETE',
        path: '/channels/{{channelId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '채널 먼저 삭제',
      },
      {
        id: 'delete-category-success',
        method: 'DELETE',
        path: '/channels/categories/{{categoryId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '채널 삭제 후 분류 삭제 성공',
      },
    ],
  },
];
