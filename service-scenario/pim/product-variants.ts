import { z } from 'zod';
import type { Scenario } from '../types';

export const productVariantScenarios: Scenario[] = [
  // ===== Group 1: Basic Variant Retrieval =====
  {
    id: 'VAR-001',
    name: 'Master 생성 → 옵션 추가 → Variant 자동 생성 → 조회',
    category: 'PIM > Product Variant',
    validation: '옵션 조합으로 Variant가 자동 생성되고 정상 조회되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Test Product with Options',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                description: '상품 색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
                  { displayName: '파랑', colorCode: '#0000FF', sortOrder: 2 },
                ],
              },
              {
                displayName: '사이즈',
                description: '상품 사이즈',
                sortOrder: 1,
                values: [
                  { displayName: 'S', sortOrder: 1 },
                  { displayName: 'M', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (색상 2개 × 사이즈 2개 = 4개 variant 생성)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Master의 Variant 목록 조회',
        responseSchema: z.object({
          data: z.array(
            z.object({
              id: z.string().uuid(),
              masterId: z.string().uuid(),
              variantName: z.string().nullable(),
              status: z.string(),
              isDefault: z.boolean().nullable(),
            }),
          ),
          total: z.literal(4),
          page: z.number(),
          limit: z.number(),
        }),
      },
    ],
  },

  {
    id: 'VAR-002',
    name: '특정 버전의 Variant 조회',
    category: 'PIM > Product Variant',
    validation: '버전별로 독립적인 Variant 세트를 갖는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options-v1',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Version 1 Product',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
                  { displayName: '파랑', colorCode: '#0000FF', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: 'V1에 옵션 추가 (2개 variant)',
      },
      {
        id: 'publish-v1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: 'V1 Publish',
      },
      {
        id: 'create-v2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {},
        expectedStatus: 201,
        description: '새 Draft 버전 생성',
        extractFromResponse: { newVersionId: 'id' },
      },
      {
        id: 'add-options-v2',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{newVersionId}}',
        body: {
          name: 'Version 2 Product',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
                  { displayName: '파랑', colorCode: '#0000FF', sortOrder: 2 },
                  { displayName: '녹색', colorCode: '#00FF00', sortOrder: 3 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: 'V2에 옵션 추가 (3개 variant)',
      },
      {
        id: 'get-v1-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}/versions/{{versionId}}',
        expectedStatus: 200,
        description: 'V1의 Variant 조회 (2개 확인)',
        responseSchema: z.object({
          total: z.literal(2),
        }),
      },
      {
        id: 'get-v2-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}/versions/{{newVersionId}}',
        expectedStatus: 200,
        description: 'V2의 Variant 조회 (3개 확인)',
        responseSchema: z.object({
          total: z.literal(3),
        }),
      },
    ],
  },

  {
    id: 'VAR-003',
    name: '페이지네이션 및 상태 필터링',
    category: 'PIM > Product Variant',
    validation: '페이지네이션과 상태 필터가 정상 동작하는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product with Many Variants',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', sortOrder: 1 },
                  { displayName: '파랑', sortOrder: 2 },
                  { displayName: '녹색', sortOrder: 3 },
                  { displayName: '노랑', sortOrder: 4 },
                  { displayName: '검정', sortOrder: 5 },
                ],
              },
              {
                displayName: '사이즈',
                sortOrder: 1,
                values: [
                  { displayName: 'S', sortOrder: 1 },
                  { displayName: 'M', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (5×2 = 10개 variant)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-all-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: '전체 Variant 조회',
        extractFromResponse: {
          variantId1: 'data.0.id',
          variantId2: 'data.1.id',
          variantId3: 'data.2.id',
        },
      },
      {
        id: 'deactivate-some-variants',
        method: 'PUT',
        path: '/variants/{{variantId1}}/status',
        body: { status: 'inactive' },
        expectedStatus: 200,
        description: '일부 Variant를 inactive로 변경',
      },
      {
        id: 'deactivate-variant2',
        method: 'PUT',
        path: '/variants/{{variantId2}}/status',
        body: { status: 'inactive' },
        expectedStatus: 200,
        description: '추가 Variant를 inactive로 변경',
      },
      {
        id: 'get-page1',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        queryParams: { page: '1', limit: '5' },
        expectedStatus: 200,
        description: '페이지 1 조회 (5개)',
        responseSchema: z.object({
          data: z.array(z.any()).length(5),
          total: z.literal(10),
          page: z.literal(1),
          limit: z.literal(5),
        }),
      },
      {
        id: 'get-page2',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        queryParams: { page: '2', limit: '5' },
        expectedStatus: 200,
        description: '페이지 2 조회 (5개)',
        responseSchema: z.object({
          data: z.array(z.any()).length(5),
          page: z.literal(2),
        }),
      },
      {
        id: 'filter-active',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        queryParams: { status: 'active' },
        expectedStatus: 200,
        description: 'Active Variant만 조회',
        responseSchema: z.object({
          total: z.literal(8),
        }),
      },
      {
        id: 'filter-inactive',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        queryParams: { status: 'inactive' },
        expectedStatus: 200,
        description: 'Inactive Variant만 조회',
        responseSchema: z.object({
          total: z.literal(2),
        }),
      },
    ],
  },

  {
    id: 'VAR-004',
    name: 'includePrice 파라미터 테스트',
    category: 'PIM > Product Variant',
    validation: 'includePrice 파라미터로 가격 포함 여부를 제어할 수 있는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Price Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', sortOrder: 1 },
                  { displayName: '파랑', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-with-price',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        queryParams: { includePrice: 'true' },
        expectedStatus: 200,
        description: '가격 포함하여 조회',
        responseSchema: z.object({
          data: z.array(
            z.object({
              id: z.string().uuid(),
              price: z.number(),
            }),
          ),
        }),
      },
      {
        id: 'get-without-price',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        queryParams: { includePrice: 'false' },
        expectedStatus: 200,
        description: '가격 없이 조회',
        responseSchema: z.object({
          data: z.array(
            z.object({
              id: z.string().uuid(),
            }),
          ),
        }),
      },
    ],
  },

  {
    id: 'VAR-005',
    name: '단일 Variant 상세 조회 (versionId 사용)',
    category: 'PIM > Product Variant',
    validation: '특정 Variant의 상세 정보와 옵션 값이 정상 조회되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Detail Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
                  { displayName: '파랑', colorCode: '#0000FF', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 목록 조회',
        extractFromResponse: { variantId: 'data.0.id' },
      },
      {
        id: 'get-variant-detail',
        method: 'GET',
        path: '/variants/{{variantId}}',
        queryParams: { versionId: '{{versionId}}' },
        expectedStatus: 200,
        description: 'Variant 상세 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          masterId: z.string().uuid(),
          variantName: z.string().nullable(),
          status: z.string(),
          optionValues: z.array(
            z.object({
              id: z.string().uuid(),
              displayName: z.string().optional(),
            }),
          ),
          price: z.number(),
        }),
      },
    ],
  },

  // ===== Group 2: Variant 수정 =====
  {
    id: 'VAR-006',
    name: '단일 Variant 수정 (이름, 이미지, 상태)',
    category: 'PIM > Product Variant',
    validation: 'Variant의 속성을 수정하고 정상 반영되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Update Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [{ displayName: '빨강', sortOrder: 1 }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: { variantId: 'data.0.id' },
      },
      {
        id: 'update-variant',
        method: 'PUT',
        path: '/variants/{{variantId}}',
        body: {
          variantName: 'Updated Variant Name',
          images: ['https://example.com/image1.jpg', 'https://example.com/image2.png'],
          status: 'inactive',
        },
        expectedStatus: 200,
        description: 'Variant 수정',
      },
      {
        id: 'verify-update',
        method: 'GET',
        path: '/variants/{{variantId}}',
        queryParams: { masterId: '{{masterId}}' },
        expectedStatus: 200,
        description: '수정 확인',
        responseSchema: z.object({
          variantName: z.literal('Updated Variant Name'),
          status: z.literal('inactive'),
        }),
      },
    ],
  },

  {
    id: 'VAR-007',
    name: 'Variant 상태만 변경',
    category: 'PIM > Product Variant',
    validation: 'Variant 상태를 active/inactive로 전환할 수 있는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Status Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [{ displayName: '빨강', sortOrder: 1 }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: { variantId: 'data.0.id' },
      },
      {
        id: 'deactivate-variant',
        method: 'PUT',
        path: '/variants/{{variantId}}/status',
        body: { status: 'inactive' },
        expectedStatus: 200,
        description: 'Variant 비활성화',
      },
      {
        id: 'verify-inactive',
        method: 'GET',
        path: '/variants/{{variantId}}',
        queryParams: { masterId: '{{masterId}}' },
        expectedStatus: 200,
        description: '비활성화 확인',
        responseSchema: z.object({
          status: z.literal('inactive'),
        }),
      },
      {
        id: 'activate-variant',
        method: 'PUT',
        path: '/variants/{{variantId}}/status',
        body: { status: 'active' },
        expectedStatus: 200,
        description: 'Variant 활성화',
      },
      {
        id: 'verify-active',
        method: 'GET',
        path: '/variants/{{variantId}}',
        queryParams: { masterId: '{{masterId}}' },
        expectedStatus: 200,
        description: '활성화 확인',
        responseSchema: z.object({
          status: z.literal('active'),
        }),
      },
    ],
  },

  {
    id: 'VAR-008',
    name: 'Bulk Update - 여러 Variant 일괄 수정',
    category: 'PIM > Product Variant',
    validation: '여러 Variant를 한 번에 수정할 수 있는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Bulk Update',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', sortOrder: 1 },
                  { displayName: '파랑', sortOrder: 2 },
                ],
              },
              {
                displayName: '사이즈',
                sortOrder: 1,
                values: [
                  { displayName: 'S', sortOrder: 1 },
                  { displayName: 'M', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (4개 variant)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: {
          variantId1: 'data.0.id',
          variantId2: 'data.1.id',
          variantId3: 'data.2.id',
          variantId4: 'data.3.id',
        },
      },
      {
        id: 'bulk-update',
        method: 'PUT',
        path: '/variants/bulk',
        body: {
          updates: [
            { id: '{{variantId1}}', variantName: 'New Name 1', displayOrder: 1 },
            { id: '{{variantId2}}', status: 'inactive', displayOrder: 2 },
            {
              id: '{{variantId3}}',
              images: ['https://example.com/img3.jpg'],
              displayOrder: 3,
            },
            { id: '{{variantId4}}', variantName: 'New Name 4', status: 'inactive' },
          ],
        },
        expectedStatus: 200,
        description: '4개 Variant 일괄 수정',
      },
      {
        id: 'verify-variant1',
        method: 'GET',
        path: '/variants/{{variantId1}}',
        queryParams: { masterId: '{{masterId}}' },
        expectedStatus: 200,
        description: 'Variant 1 수정 확인',
        responseSchema: z.object({
          variantName: z.literal('New Name 1'),
        }),
      },
      {
        id: 'verify-variant2',
        method: 'GET',
        path: '/variants/{{variantId2}}',
        queryParams: { masterId: '{{masterId}}' },
        expectedStatus: 200,
        description: 'Variant 2 수정 확인',
        responseSchema: z.object({
          status: z.literal('inactive'),
        }),
      },
    ],
  },

  {
    id: 'VAR-009',
    name: 'Bulk Update - displayOrder 정렬 확인',
    category: 'PIM > Product Variant',
    validation: 'displayOrder를 일괄 설정하고 정렬이 정상 반영되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Order Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', sortOrder: 1 },
                  { displayName: '파랑', sortOrder: 2 },
                  { displayName: '녹색', sortOrder: 3 },
                  { displayName: '노랑', sortOrder: 4 },
                  { displayName: '검정', sortOrder: 5 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가 (5개 variant)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: {
          variantId1: 'data.0.id',
          variantId2: 'data.1.id',
          variantId3: 'data.2.id',
          variantId4: 'data.3.id',
          variantId5: 'data.4.id',
        },
      },
      {
        id: 'set-display-order',
        method: 'PUT',
        path: '/variants/bulk',
        body: {
          updates: [
            { id: '{{variantId1}}', displayOrder: 5 },
            { id: '{{variantId2}}', displayOrder: 4 },
            { id: '{{variantId3}}', displayOrder: 3 },
            { id: '{{variantId4}}', displayOrder: 2 },
            { id: '{{variantId5}}', displayOrder: 1 },
          ],
        },
        expectedStatus: 200,
        description: 'displayOrder 역순으로 설정',
      },
      {
        id: 'verify-order',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: '정렬 순서 확인',
        responseSchema: z.object({
          data: z.array(z.any()).length(5),
        }),
      },
    ],
  },

  {
    id: 'VAR-010',
    name: 'Variant 수정 - 이미지 URL 유효성 검사',
    category: 'PIM > Product Variant',
    validation: '이미지 URL이 정상적으로 저장되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Image Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [{ displayName: '빨강', sortOrder: 1 }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variant',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: { variantId: 'data.0.id' },
      },
      {
        id: 'update-images',
        method: 'PUT',
        path: '/variants/{{variantId}}',
        body: {
          images: [
            'https://example.com/img1.jpg',
            'https://example.com/img2.png',
            'https://example.com/img3.webp',
          ],
        },
        expectedStatus: 200,
        description: '이미지 URL 설정',
      },
      {
        id: 'verify-images',
        method: 'GET',
        path: '/variants/{{variantId}}',
        queryParams: { masterId: '{{masterId}}' },
        expectedStatus: 200,
        description: '이미지 저장 확인',
      },
    ],
  },

  // ===== Group 3: 옵션 없는 경우 및 Default Variant =====
  {
    id: 'VAR-011',
    name: '옵션 없는 상품의 기본 Variant',
    category: 'PIM > Product Variant',
    validation: '옵션이 없는 상품은 기본 Variant 1개가 생성되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'update-without-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Simple Product without Options',
        },
        expectedStatus: 200,
        description: '옵션 없이 상품 정보만 수정',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        responseSchema: z.object({
          data: z.array(
            z.object({
              isDefault: z.literal(true),
              variantName: z.null(),
            }),
          ),
          total: z.literal(1),
        }),
      },
    ],
  },

  {
    id: 'VAR-012',
    name: '옵션 추가 후 기본 Variant 삭제 확인',
    category: 'PIM > Product Variant',
    validation: '새 버전에 옵션을 추가하면 기본 Variant가 옵션 조합 Variant로 대체되는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'update-without-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product Starting Simple',
        },
        expectedStatus: 200,
        description: '옵션 없이 수정',
      },
      {
        id: 'publish-v1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: 'V1 Publish',
      },
      {
        id: 'verify-default-variant',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: '기본 Variant 확인',
        responseSchema: z.object({
          total: z.literal(1),
          data: z.array(
            z.object({
              isDefault: z.literal(true),
            }),
          ),
        }),
      },
      {
        id: 'create-v2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {},
        expectedStatus: 201,
        description: '새 Draft 버전 생성',
        extractFromResponse: { newVersionId: 'id' },
      },
      {
        id: 'add-options-v2',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{newVersionId}}',
        body: {
          name: 'Product with Options',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [
                  { displayName: '빨강', sortOrder: 1 },
                  { displayName: '파랑', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: 'V2에 옵션 추가',
      },
      {
        id: 'publish-v2',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{newVersionId}}/publish',
        expectedStatus: 200,
        description: 'V2 Publish',
      },
      {
        id: 'verify-option-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}/versions/{{newVersionId}}',
        expectedStatus: 200,
        description: 'V2의 Variant 확인',
        responseSchema: z.object({
          total: z.literal(2),
          data: z.array(
            z.object({
              isDefault: z.literal(false),
            }),
          ),
        }),
      },
    ],
  },

  // ===== Group 4: Deprecated Endpoint =====
  {
    id: 'VAR-013',
    name: '가격 조회 Deprecated 엔드포인트 테스트',
    category: 'PIM > Product Variant',
    validation: 'Deprecated된 가격 조회 엔드포인트가 410 GONE을 반환하는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Deprecated Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [{ displayName: '빨강', sortOrder: 1 }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variant',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: { variantId: 'data.0.id' },
      },
      {
        id: 'get-deprecated-price',
        method: 'GET',
        path: '/variants/{{variantId}}/price',
        expectedStatus: 410,
        description: 'Deprecated 가격 조회 엔드포인트 (410 GONE)',
        responseSchema: z.object({
          statusCode: z.literal(410),
          message: z.string(),
        }),
      },
    ],
  },

  // ===== Group 5: 에러 케이스 =====
  {
    id: 'VAR-014',
    name: '에러 - 존재하지 않는 Variant 조회/수정',
    category: 'PIM > Product Variant',
    validation: '존재하지 않는 Variant에 대한 요청이 404를 반환하는지 확인',
    steps: [
      {
        id: 'get-nonexistent-variant',
        method: 'GET',
        path: '/variants/00000000-0000-0000-0000-000000000000',
        queryParams: { masterId: '00000000-0000-0000-0000-000000000000' },
        expectedStatus: 404,
        description: '존재하지 않는 Variant 조회 (404)',
      },
      {
        id: 'update-nonexistent-variant',
        method: 'PUT',
        path: '/variants/00000000-0000-0000-0000-000000000000',
        body: { variantName: 'Test' },
        expectedStatus: 404,
        description: '존재하지 않는 Variant 수정 (404)',
      },
      {
        id: 'update-status-nonexistent',
        method: 'PUT',
        path: '/variants/00000000-0000-0000-0000-000000000000/status',
        body: { status: 'active' },
        expectedStatus: 404,
        description: '존재하지 않는 Variant 상태 변경 (404)',
      },
    ],
  },

  {
    id: 'VAR-015',
    name: '에러 - 잘못된 요청 데이터',
    category: 'PIM > Product Variant',
    validation: '잘못된 요청 데이터가 400 Bad Request를 반환하는지 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Product for Error Test',
          optionDiff: {
            add: [
              {
                displayName: '색상',
                sortOrder: 0,
                values: [{ displayName: '빨강', sortOrder: 1 }],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-variant',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Variant 조회',
        extractFromResponse: { variantId: 'data.0.id' },
      },
      {
        id: 'invalid-status',
        method: 'PUT',
        path: '/variants/{{variantId}}',
        body: { status: 'invalid_status' },
        expectedStatus: 400,
        description: '잘못된 status 값 (400)',
      },
      {
        id: 'missing-status',
        method: 'PUT',
        path: '/variants/{{variantId}}/status',
        body: {},
        expectedStatus: 400,
        description: 'status 필드 누락 (400)',
      },
      {
        id: 'empty-bulk-updates',
        method: 'PUT',
        path: '/variants/bulk',
        body: { updates: [] },
        expectedStatus: 400,
        description: '빈 updates 배열 (400)',
      },
    ],
  },
];
