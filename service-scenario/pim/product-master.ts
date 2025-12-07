import { z } from 'zod';
import type { Scenario } from '../types';

/**
 * PIM Product Master & Version Management API Test Scenarios
 *
 * Coverage: 17 endpoints (9 Master + 8 Version)
 * - Product Master CRUD with soft/hard delete
 * - Version lifecycle (draft → active → inactive)
 * - Option management via optionDiff
 * - Category and tag association
 * - Version comparison and tree navigation
 *
 * Total Scenarios: 20
 */

export const productMasterScenarios: Scenario[] = [
  // ========================================
  // Group 1: Basic CRUD Operations
  // ========================================
  {
    id: 'PROD-001',
    name: '상품 마스터 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Product Master',
    validation: 'CRUD 전체 플로우 및 404 에러 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 생성 (빈 객체)',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          masterId: z.string().uuid(),
          version: z.literal(1),
          status: z.literal('draft'),
        }),
      },
      {
        id: 'get-master-detail',
        method: 'GET',
        path: '/masters/{{masterId}}',
        expectedStatus: 200,
        description: '마스터 상세 조회 (Active 버전)',
        responseSchema: z.object({
          id: z.string().uuid(),
          masterId: z.string().uuid(),
          status: z.enum(['draft', 'active', 'inactive']),
        }),
      },
      {
        id: 'update-draft-version',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Updated Product Name',
          description: 'Product description',
          brand: 'Test Brand',
        },
        expectedStatus: 200,
        description: 'Draft 버전 수정',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.literal('Updated Product Name'),
        }),
      },
      {
        id: 'delete-master',
        method: 'DELETE',
        path: '/masters/{{masterId}}',
        expectedStatus: 200,
        description: '마스터 소프트 삭제',
        responseSchema: z.object({
          success: z.literal(true),
          masterId: z.string().uuid(),
        }),
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/masters/{{masterId}}',
        expectedStatus: 404,
        description: '삭제된 마스터 조회 (404 기대)',
      },
    ],
  },

  {
    id: 'PROD-002',
    name: '상품 소프트 삭제 → 복원',
    category: 'PIM > Product Master',
    validation: '삭제된 상품 목록 조회 및 복원 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product to Delete',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId' },
      },
      {
        id: 'soft-delete',
        method: 'DELETE',
        path: '/masters/{{masterId}}',
        expectedStatus: 200,
        description: '마스터 소프트 삭제',
      },
      {
        id: 'list-deleted',
        method: 'GET',
        path: '/masters/deleted',
        expectedStatus: 200,
        description: '삭제된 마스터 목록 조회',
        responseSchema: z.array(z.any()),
      },
      {
        id: 'restore-master',
        method: 'POST',
        path: '/masters/{{masterId}}/restore',
        expectedStatus: 200,
        description: '마스터 복원',
        responseSchema: z.object({
          success: z.literal(true),
          masterId: z.string().uuid(),
        }),
      },
      {
        id: 'verify-restored',
        method: 'GET',
        path: '/masters/{{masterId}}',
        expectedStatus: 200,
        description: '복원된 마스터 조회',
      },
    ],
  },

  {
    id: 'PROD-003',
    name: '상품 Publish → Unpublish',
    category: 'PIM > Product Master',
    validation: 'Active → Inactive 상태 전환 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product for Publish Test',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish (Draft → Active)',
        responseSchema: z.object({
          message: z.string(),
          masterId: z.string().uuid(),
          versionId: z.string().uuid(),
        }),
      },
      {
        id: 'get-active-version',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/active',
        expectedStatus: 200,
        description: 'Active 버전 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          status: z.literal('active'),
        }),
      },
      {
        id: 'unpublish-master',
        method: 'PATCH',
        path: '/masters/{{masterId}}/unpublish',
        expectedStatus: 200,
        description: '마스터 비공개 처리 (Active → Inactive)',
        responseSchema: z.object({
          success: z.literal(true),
          masterId: z.string().uuid(),
        }),
      },
      {
        id: 'verify-inactive',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/active',
        expectedStatus: 404,
        description: 'Active 버전 없음 확인 (404 기대)',
      },
    ],
  },

  // ========================================
  // Group 2: Version Management
  // ========================================
  {
    id: 'PROD-004',
    name: '버전 트리 조회 및 Active 버전 확인',
    category: 'PIM > Product Version',
    validation: '버전 트리 구조 및 Active 버전 조회',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product with Versions',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'get-version-tree',
        method: 'GET',
        path: '/masters/{{masterId}}/versions',
        expectedStatus: 200,
        description: '버전 트리 조회',
        responseSchema: z.array(
          z.object({
            id: z.string().uuid(),
            masterId: z.string().uuid(),
            version: z.number(),
            status: z.enum(['draft', 'active', 'inactive']),
          }),
        ),
      },
      {
        id: 'get-specific-version',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        expectedStatus: 200,
        description: '특정 버전 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          masterId: z.string().uuid(),
          version: z.literal(1),
        }),
      },
      {
        id: 'publish-version1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '버전 1 Publish',
      },
      {
        id: 'get-active-version',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/active',
        expectedStatus: 200,
        description: 'Active 버전 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          version: z.literal(1),
          status: z.literal('active'),
        }),
      },
    ],
  },

  {
    id: 'PROD-005',
    name: 'Active 버전에서 새 Draft 생성 → 수정 → Publish',
    category: 'PIM > Product Version',
    validation: '버전 복제 및 Publish 시 기존 Active → Inactive 전환 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Multi Version Product',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'publish-version1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '버전 1 Publish',
      },
      {
        id: 'create-draft-version',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {
          copyMappings: true,
        },
        expectedStatus: 201,
        description: '새 Draft 버전 생성 (Active 버전 기반)',
        extractFromResponse: { version2Id: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          version: z.literal(2),
          status: z.literal('draft'),
          parentVersionId: z.string().uuid(),
        }),
      },
      {
        id: 'update-draft-version',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        body: {
          name: 'Updated Product V2',
          description: 'Version 2 description',
        },
        expectedStatus: 200,
        description: 'Draft 버전 수정',
      },
      {
        id: 'publish-version2',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: '버전 2 Publish',
      },
      {
        id: 'get-version-tree',
        method: 'GET',
        path: '/masters/{{masterId}}/versions',
        expectedStatus: 200,
        description: '버전 트리 확인 (v1 inactive, v2 active)',
      },
    ],
  },

  {
    id: 'PROD-006',
    name: '버전 비교 (Version Comparison)',
    category: 'PIM > Product Version',
    validation: '두 버전 간 차이 조회',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Version Compare Test',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'update-version1',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          name: 'Product V1',
          brand: 'Brand A',
        },
        expectedStatus: 200,
        description: '버전 1 수정',
      },
      {
        id: 'publish-version1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '버전 1 Publish',
      },
      {
        id: 'create-version2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {},
        expectedStatus: 201,
        description: '버전 2 생성',
        extractFromResponse: { version2Id: 'id' },
      },
      {
        id: 'update-version2',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        body: {
          name: 'Product V2',
          brand: 'Brand B',
          description: 'New description',
        },
        expectedStatus: 200,
        description: '버전 2 수정',
      },
      {
        id: 'compare-versions',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/compare/{{version1Id}}',
        expectedStatus: 200,
        description: '버전 비교',
        responseSchema: z.object({
          versionId: z.string().uuid(),
          compareVersionId: z.string().uuid(),
          differences: z.array(z.any()),
        }),
      },
    ],
  },

  {
    id: 'PROD-007',
    name: 'Draft 버전 삭제',
    category: 'PIM > Product Version',
    validation: 'Draft 버전만 삭제 가능, Active/Inactive는 삭제 불가',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Draft Delete Test',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', draftVersionId: 'id' },
      },
      {
        id: 'create-another-draft',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {},
        expectedStatus: 201,
        description: '추가 Draft 버전 생성',
        extractFromResponse: { version2Id: 'id' },
      },
      {
        id: 'delete-draft-version',
        method: 'DELETE',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        expectedStatus: 200,
        description: 'Draft 버전 삭제',
        responseSchema: z.object({
          success: z.literal(true),
        }),
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        expectedStatus: 404,
        description: '삭제된 버전 조회 (404 기대)',
      },
      {
        id: 'get-remaining-versions',
        method: 'GET',
        path: '/masters/{{masterId}}/versions',
        expectedStatus: 200,
        description: '남은 버전 확인',
      },
    ],
  },

  // ========================================
  // Group 3: Option Management
  // ========================================
  {
    id: 'PROD-008',
    name: '옵션 추가 (Add Options)',
    category: 'PIM > Product Option',
    validation: 'optionDiff.add로 옵션 그룹 및 값 추가',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product with Options',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                description: 'Product color',
                sortOrder: 0,
                values: [
                  { displayName: 'Red', colorCode: '#FF0000', sortOrder: 1 },
                  { displayName: 'Blue', colorCode: '#0000FF', sortOrder: 2 },
                ],
              },
              {
                displayName: 'Size',
                sortOrder: 1,
                values: [
                  { displayName: 'Small', sortOrder: 1 },
                  { displayName: 'Medium', sortOrder: 2 },
                  { displayName: 'Large', sortOrder: 3 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 그룹 및 값 추가',
      },
      {
        id: 'get-version-with-options',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        expectedStatus: 200,
        description: '옵션이 추가된 버전 조회',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
    ],
  },

  {
    id: 'PROD-009',
    name: '옵션 표시 정보 수정 및 값 추가',
    category: 'PIM > Product Option',
    validation: 'optionDiff.modifyDisplay 및 addValues 사용',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Option Modify Test',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-initial-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                sortOrder: 0,
                values: [
                  { displayName: 'Red', colorCode: '#FF0000', sortOrder: 1 },
                  { displayName: 'Blue', colorCode: '#0000FF', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '초기 옵션 추가',
        extractFromResponse: { colorGroupId: 'optionGroups.0.id' },
      },
      {
        id: 'modify-and-add-values',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          optionDiff: {
            modifyDisplay: [
              {
                optionGroupId: '{{colorGroupId}}',
                displayName: 'Color Selection',
                description: 'Choose your preferred color',
              },
            ],
            addValues: [
              {
                optionGroupId: '{{colorGroupId}}',
                values: [
                  { displayName: 'Green', colorCode: '#00FF00', sortOrder: 3 },
                  { displayName: 'Yellow', colorCode: '#FFFF00', sortOrder: 4 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 표시명 수정 및 값 추가',
      },
      {
        id: 'verify-changes',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        expectedStatus: 200,
        description: '변경사항 확인',
      },
    ],
  },

  {
    id: 'PROD-010',
    name: '옵션 값 제거 및 옵션 그룹 제거',
    category: 'PIM > Product Option',
    validation: 'optionDiff.removeValues 및 remove 사용',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Option Remove Test',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Red', sortOrder: 1 },
                  { displayName: 'Blue', sortOrder: 2 },
                  { displayName: 'Green', sortOrder: 3 },
                ],
              },
              {
                displayName: 'Size',
                values: [
                  { displayName: 'S', sortOrder: 1 },
                  { displayName: 'M', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 추가',
        extractFromResponse: {
          colorGroupId: 'optionGroups.0.id',
          sizeGroupId: 'optionGroups.1.id',
          colorValue1Id: 'optionGroups.0.values.0.id',
        },
      },
      {
        id: 'remove-option-value',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          optionDiff: {
            removeValues: [
              {
                optionGroupId: '{{colorGroupId}}',
                optionValueIds: ['{{colorValue1Id}}'],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '옵션 값 제거 (Red 제거)',
      },
      {
        id: 'remove-option-group',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          optionDiff: {
            remove: ['{{sizeGroupId}}'],
          },
        },
        expectedStatus: 200,
        description: '옵션 그룹 제거 (Size 제거)',
      },
      {
        id: 'verify-removals',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        expectedStatus: 200,
        description: '제거 확인',
      },
    ],
  },

  {
    id: 'PROD-011',
    name: '복잡한 옵션 구조 (여러 그룹, 색상 코드, 이미지)',
    category: 'PIM > Product Option',
    validation: '다중 옵션 그룹, 색상, 이미지 URL 포함',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Complex Options Product',
          brand: 'Premium Brand',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'add-complex-options',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          name: 'Premium T-Shirt',
          description: 'High-quality cotton t-shirt',
          optionDiff: {
            add: [
              {
                displayName: 'Color',
                description: 'Available colors',
                sortOrder: 0,
                values: [
                  {
                    displayName: 'Navy Blue',
                    colorCode: '#000080',
                    imageUrl: 'https://example.com/navy.jpg',
                    sortOrder: 1,
                  },
                  {
                    displayName: 'Charcoal Gray',
                    colorCode: '#36454F',
                    imageUrl: 'https://example.com/charcoal.jpg',
                    sortOrder: 2,
                  },
                  {
                    displayName: 'Forest Green',
                    colorCode: '#228B22',
                    imageUrl: 'https://example.com/forest.jpg',
                    sortOrder: 3,
                  },
                ],
              },
              {
                displayName: 'Size',
                description: 'US sizing',
                sortOrder: 1,
                values: [
                  { displayName: 'XS', sortOrder: 1 },
                  { displayName: 'S', sortOrder: 2 },
                  { displayName: 'M', sortOrder: 3 },
                  { displayName: 'L', sortOrder: 4 },
                  { displayName: 'XL', sortOrder: 5 },
                  { displayName: 'XXL', sortOrder: 6 },
                ],
              },
              {
                displayName: 'Material',
                sortOrder: 2,
                values: [
                  { displayName: '100% Cotton', sortOrder: 1 },
                  { displayName: 'Cotton Blend', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: '복잡한 옵션 구조 추가',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
      },
      {
        id: 'get-published-product',
        method: 'GET',
        path: '/masters/{{masterId}}',
        expectedStatus: 200,
        description: 'Publish된 상품 조회',
      },
    ],
  },

  // ========================================
  // Group 4: Category & Tag Association
  // ========================================
  {
    id: 'PROD-012',
    name: '카테고리 연결 및 업데이트',
    category: 'PIM > Product Master',
    validation: 'categoryIds 및 primaryCategoryId 설정',
    steps: [
      {
        id: 'create-category1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Electronics',
          slug: 'electronics-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 1 생성',
        extractFromResponse: { category1Id: 'id' },
      },
      {
        id: 'create-category2',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Accessories',
          slug: 'accessories-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 2 생성',
        extractFromResponse: { category2Id: 'id' },
      },
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product with Categories',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'associate-categories',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          categoryIds: ['{{category1Id}}', '{{category2Id}}'],
          primaryCategoryId: '{{category1Id}}',
        },
        expectedStatus: 200,
        description: '카테고리 연결',
      },
      {
        id: 'update-categories',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          categoryIds: ['{{category2Id}}'],
          primaryCategoryId: '{{category2Id}}',
        },
        expectedStatus: 200,
        description: '카테고리 업데이트 (category2만 유지)',
      },
      {
        id: 'verify-categories',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        expectedStatus: 200,
        description: '카테고리 변경 확인',
      },
    ],
  },

  {
    id: 'PROD-013',
    name: '태그 연결 및 업데이트',
    category: 'PIM > Product Master',
    validation: 'tagValueIds 설정 및 업데이트',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: 'Product Tags {{timestamp}}',
          description: 'Tags for products',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { tagGroupId: 'id' },
      },
      {
        id: 'create-tag-value1',
        method: 'POST',
        path: '/tags/groups/{{tagGroupId}}/values',
        body: {
          name: 'New Arrival',
          description: 'Newly launched products',
        },
        expectedStatus: 201,
        description: '태그 값 1 생성',
        extractFromResponse: { tagValue1Id: 'id' },
      },
      {
        id: 'create-tag-value2',
        method: 'POST',
        path: '/tags/groups/{{tagGroupId}}/values',
        body: {
          name: 'Best Seller',
          description: 'Top selling products',
        },
        expectedStatus: 201,
        description: '태그 값 2 생성',
        extractFromResponse: { tagValue2Id: 'id' },
      },
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product with Tags',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'associate-tags',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          tagValueIds: ['{{tagValue1Id}}'],
        },
        expectedStatus: 200,
        description: '태그 연결',
      },
      {
        id: 'update-tags',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        body: {
          tagValueIds: ['{{tagValue1Id}}', '{{tagValue2Id}}'],
        },
        expectedStatus: 200,
        description: '태그 업데이트 (추가)',
      },
      {
        id: 'verify-tags',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{versionId}}',
        expectedStatus: 200,
        description: '태그 변경 확인',
      },
    ],
  },

  // ========================================
  // Group 5: Listing & Filtering
  // ========================================
  {
    id: 'PROD-014',
    name: '상품 목록 조회 및 페이지네이션',
    category: 'PIM > Product Master',
    validation: 'GET /masters with pagination',
    steps: [
      {
        id: 'create-master1',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product 1 for List',
        },
        expectedStatus: 201,
        description: '상품 1 생성',
        extractFromResponse: { master1Id: 'masterId', version1Id: 'id' },
      },
      {
        id: 'publish-master1',
        method: 'PATCH',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '상품 1 Publish',
      },
      {
        id: 'create-master2',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product 2 for List',
        },
        expectedStatus: 201,
        description: '상품 2 생성',
        extractFromResponse: { master2Id: 'masterId', version2Id: 'id' },
      },
      {
        id: 'publish-master2',
        method: 'PATCH',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: '상품 2 Publish',
      },
      {
        id: 'create-master3',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product 3 for List',
        },
        expectedStatus: 201,
        description: '상품 3 생성 (Draft 유지)',
      },
      {
        id: 'list-all-products',
        method: 'GET',
        path: '/masters',
        expectedStatus: 200,
        description: '전체 상품 목록 조회',
        responseSchema: z.object({
          items: z.array(z.any()),
          total: z.number(),
          page: z.number(),
          limit: z.number(),
        }),
      },
      {
        id: 'list-page1',
        method: 'GET',
        path: '/masters',
        queryParams: {
          page: '1',
          limit: '2',
        },
        expectedStatus: 200,
        description: '페이지 1 조회 (limit=2)',
      },
      {
        id: 'list-active-mode',
        method: 'GET',
        path: '/masters',
        queryParams: {
          mode: 'active',
        },
        expectedStatus: 200,
        description: 'Active 상품만 조회',
      },
    ],
  },

  {
    id: 'PROD-015',
    name: '브랜드 필터링',
    category: 'PIM > Product Master',
    validation: 'Brand 필터 사용',
    steps: [
      {
        id: 'create-master-brand-a',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product Brand A',
        },
        expectedStatus: 201,
        description: 'Brand A 상품 생성',
        extractFromResponse: { masterAId: 'masterId', versionAId: 'id' },
      },
      {
        id: 'update-brand-a',
        method: 'PUT',
        path: '/masters/{{masterAId}}/versions/{{versionAId}}',
        body: {
          brand: 'Brand A',
        },
        expectedStatus: 200,
        description: 'Brand A 설정',
      },
      {
        id: 'publish-brand-a',
        method: 'PATCH',
        path: '/masters/{{masterAId}}/versions/{{versionAId}}/publish',
        expectedStatus: 200,
        description: 'Brand A 상품 Publish',
      },
      {
        id: 'create-master-brand-b',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product Brand B',
        },
        expectedStatus: 201,
        description: 'Brand B 상품 생성',
        extractFromResponse: { masterBId: 'masterId', versionBId: 'id' },
      },
      {
        id: 'update-brand-b',
        method: 'PUT',
        path: '/masters/{{masterBId}}/versions/{{versionBId}}',
        body: {
          brand: 'Brand B',
        },
        expectedStatus: 200,
        description: 'Brand B 설정',
      },
      {
        id: 'publish-brand-b',
        method: 'PATCH',
        path: '/masters/{{masterBId}}/versions/{{versionBId}}/publish',
        expectedStatus: 200,
        description: 'Brand B 상품 Publish',
      },
      {
        id: 'filter-by-brand-a',
        method: 'GET',
        path: '/masters',
        queryParams: {
          brand: 'Brand A',
        },
        expectedStatus: 200,
        description: 'Brand A 필터링',
      },
    ],
  },

  {
    id: 'PROD-016',
    name: '카테고리 필터링',
    category: 'PIM > Product Master',
    validation: 'categoryId 필터 사용',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Filter Test Category',
          slug: 'filter-cat-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'create-master1',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product in Category',
        },
        expectedStatus: 201,
        description: '상품 1 생성',
        extractFromResponse: { master1Id: 'masterId', version1Id: 'id' },
      },
      {
        id: 'associate-category',
        method: 'PUT',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}',
        body: {
          categoryIds: ['{{categoryId}}'],
        },
        expectedStatus: 200,
        description: '카테고리 연결',
      },
      {
        id: 'publish-master1',
        method: 'PATCH',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '상품 1 Publish',
      },
      {
        id: 'create-master2',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product without Category',
        },
        expectedStatus: 201,
        description: '상품 2 생성 (카테고리 없음)',
        extractFromResponse: { master2Id: 'masterId', version2Id: 'id' },
      },
      {
        id: 'publish-master2',
        method: 'PATCH',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: '상품 2 Publish',
      },
      {
        id: 'filter-by-category',
        method: 'GET',
        path: '/masters',
        queryParams: {
          categoryId: '{{categoryId}}',
        },
        expectedStatus: 200,
        description: '카테고리 필터링',
      },
    ],
  },

  // ========================================
  // Group 6: Deleted Products
  // ========================================
  {
    id: 'PROD-017',
    name: '삭제된 상품 목록 조회 및 복원',
    category: 'PIM > Product Master',
    validation: 'GET /masters/deleted 및 복원',
    steps: [
      {
        id: 'create-master1',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product to Delete 1',
        },
        expectedStatus: 201,
        description: '상품 1 생성',
        extractFromResponse: { master1Id: 'masterId' },
      },
      {
        id: 'create-master2',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product to Delete 2',
        },
        expectedStatus: 201,
        description: '상품 2 생성',
        extractFromResponse: { master2Id: 'masterId' },
      },
      {
        id: 'delete-master1',
        method: 'DELETE',
        path: '/masters/{{master1Id}}',
        expectedStatus: 200,
        description: '상품 1 삭제',
      },
      {
        id: 'delete-master2',
        method: 'DELETE',
        path: '/masters/{{master2Id}}',
        expectedStatus: 200,
        description: '상품 2 삭제',
      },
      {
        id: 'list-deleted-products',
        method: 'GET',
        path: '/masters/deleted',
        expectedStatus: 200,
        description: '삭제된 상품 목록 조회',
        responseSchema: z.array(
          z.object({
            masterId: z.string().uuid(),
          }),
        ),
      },
      {
        id: 'restore-master1',
        method: 'POST',
        path: '/masters/{{master1Id}}/restore',
        expectedStatus: 200,
        description: '상품 1 복원',
      },
      {
        id: 'verify-restored',
        method: 'GET',
        path: '/masters/{{master1Id}}',
        expectedStatus: 200,
        description: '복원된 상품 조회',
      },
      {
        id: 'list-deleted-after-restore',
        method: 'GET',
        path: '/masters/deleted',
        expectedStatus: 200,
        description: '삭제된 상품 목록 재조회 (1개 감소)',
      },
    ],
  },

  {
    id: 'PROD-018',
    name: '상품 영구 삭제 (Permanent Delete)',
    category: 'PIM > Product Master',
    validation: 'Hard delete 확인',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Product for Permanent Delete',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', versionId: 'id' },
      },
      {
        id: 'soft-delete',
        method: 'DELETE',
        path: '/masters/{{masterId}}',
        expectedStatus: 200,
        description: '소프트 삭제',
      },
      {
        id: 'permanent-delete',
        method: 'DELETE',
        path: '/masters/{{versionId}}/permanent',
        body: {
          userId: 'test-user-{{timestamp}}',
        },
        expectedStatus: 200,
        description: '영구 삭제',
        responseSchema: z.object({
          deleted: z.literal(true),
        }),
      },
      {
        id: 'verify-permanent-delete',
        method: 'GET',
        path: '/masters/deleted',
        expectedStatus: 200,
        description: '삭제된 목록에도 없음 확인',
      },
    ],
  },

  // ========================================
  // Group 7: Complex Workflows
  // ========================================
  {
    id: 'PROD-019',
    name: '전체 상품 라이프사이클',
    category: 'PIM > Product Master',
    validation: '생성 → 옵션 추가 → 카테고리 연결 → Publish → 새 버전 생성 → 수정 → Publish → 버전 비교',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Lifecycle Test Category',
          slug: 'lifecycle-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Full Lifecycle Product',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'update-v1-details',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          name: 'Premium Sneakers',
          description: 'High-quality athletic shoes',
          brand: 'SportPro',
        },
        expectedStatus: 200,
        description: 'V1 기본 정보 수정',
      },
      {
        id: 'add-options-v1',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          optionDiff: {
            add: [
              {
                displayName: 'Size',
                values: [
                  { displayName: '250mm', sortOrder: 1 },
                  { displayName: '260mm', sortOrder: 2 },
                  { displayName: '270mm', sortOrder: 3 },
                ],
              },
              {
                displayName: 'Color',
                values: [
                  { displayName: 'Black', colorCode: '#000000', sortOrder: 1 },
                  { displayName: 'White', colorCode: '#FFFFFF', sortOrder: 2 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: 'V1 옵션 추가',
      },
      {
        id: 'associate-category-v1',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          categoryIds: ['{{categoryId}}'],
          primaryCategoryId: '{{categoryId}}',
        },
        expectedStatus: 200,
        description: 'V1 카테고리 연결',
      },
      {
        id: 'publish-v1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: 'V1 Publish',
      },
      {
        id: 'create-v2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {
          copyMappings: true,
        },
        expectedStatus: 201,
        description: 'V2 생성',
        extractFromResponse: { version2Id: 'id' },
      },
      {
        id: 'update-v2',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        body: {
          description: 'Updated: Professional athletic footwear',
          optionDiff: {
            addValues: [
              {
                optionGroupId: '{{sizeGroupId}}',
                values: [
                  { displayName: '280mm', sortOrder: 4 },
                ],
              },
            ],
          },
        },
        expectedStatus: 200,
        description: 'V2 수정 (설명 변경, 사이즈 추가)',
        extractFromResponse: { sizeGroupId: 'optionGroups.0.id' },
      },
      {
        id: 'publish-v2',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: 'V2 Publish',
      },
      {
        id: 'compare-versions',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/compare/{{version1Id}}',
        expectedStatus: 200,
        description: 'V1과 V2 비교',
      },
      {
        id: 'get-version-tree',
        method: 'GET',
        path: '/masters/{{masterId}}/versions',
        expectedStatus: 200,
        description: '버전 트리 조회',
      },
      {
        id: 'get-active-version',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/active',
        expectedStatus: 200,
        description: 'Active 버전 조회 (V2)',
        responseSchema: z.object({
          id: z.string().uuid(),
          version: z.literal(2),
          status: z.literal('active'),
        }),
      },
    ],
  },

  {
    id: 'PROD-020',
    name: '다중 버전 관리 워크플로우',
    category: 'PIM > Product Version',
    validation: '여러 버전 생성, Publish, Draft 삭제, 트리 탐색',
    steps: [
      {
        id: 'create-master',
        method: 'POST',
        path: '/masters',
        body: {
          name: 'Multi-Version Product',
        },
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'masterId', version1Id: 'id' },
      },
      {
        id: 'update-v1',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        body: {
          name: 'Product V1',
          description: 'Version 1',
        },
        expectedStatus: 200,
        description: 'V1 수정',
      },
      {
        id: 'publish-v1',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: 'V1 Publish',
      },
      {
        id: 'create-v2',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {},
        expectedStatus: 201,
        description: 'V2 생성',
        extractFromResponse: { version2Id: 'id' },
      },
      {
        id: 'update-v2',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        body: {
          name: 'Product V2',
          description: 'Version 2',
        },
        expectedStatus: 200,
        description: 'V2 수정',
      },
      {
        id: 'publish-v2',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: 'V2 Publish (V1 → Inactive)',
      },
      {
        id: 'create-v3',
        method: 'POST',
        path: '/masters/{{masterId}}/versions',
        body: {
          parentVersionId: '{{version2Id}}',
        },
        expectedStatus: 201,
        description: 'V3 생성 (V2 기반)',
        extractFromResponse: { version3Id: 'id' },
      },
      {
        id: 'update-v3',
        method: 'PUT',
        path: '/masters/{{masterId}}/versions/{{version3Id}}',
        body: {
          name: 'Product V3 Draft',
        },
        expectedStatus: 200,
        description: 'V3 수정',
      },
      {
        id: 'get-tree-before-delete',
        method: 'GET',
        path: '/masters/{{masterId}}/versions',
        expectedStatus: 200,
        description: '버전 트리 조회 (V1 inactive, V2 active, V3 draft)',
      },
      {
        id: 'delete-v3-draft',
        method: 'DELETE',
        path: '/masters/{{masterId}}/versions/{{version3Id}}',
        expectedStatus: 200,
        description: 'V3 Draft 삭제',
      },
      {
        id: 'get-tree-after-delete',
        method: 'GET',
        path: '/masters/{{masterId}}/versions',
        expectedStatus: 200,
        description: '버전 트리 재조회 (V3 삭제됨)',
      },
      {
        id: 'get-specific-v1',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{version1Id}}',
        expectedStatus: 200,
        description: 'V1 조회 (Inactive 상태)',
        responseSchema: z.object({
          id: z.string().uuid(),
          version: z.literal(1),
          status: z.literal('inactive'),
        }),
      },
      {
        id: 'get-specific-v2',
        method: 'GET',
        path: '/masters/{{masterId}}/versions/{{version2Id}}',
        expectedStatus: 200,
        description: 'V2 조회 (Active 상태)',
        responseSchema: z.object({
          id: z.string().uuid(),
          version: z.literal(2),
          status: z.literal('active'),
        }),
      },
    ],
  },
];
