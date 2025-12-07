import { z } from 'zod';
import type { Scenario } from '../types';

/**
 * PIM Category Management API Test Scenarios
 *
 * 이 파일은 PIM 카테고리 관리 API의 모든 엔드포인트를 테스트하는 20개의 시나리오를 포함합니다.
 * 각 시나리오는 독립적으로 실행 가능하며, 필요한 선행 데이터를 자체적으로 생성합니다.
 *
 * Coverage: 16개 Category API 엔드포인트 전체
 */

export const categoryScenarios: Scenario[] = [
  // ========================================
  // Scenario Group 1: Basic CRUD Operations
  // ========================================
  {
    id: 'CAT-001',
    name: '기본 카테고리 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Category',
    validation: 'CRUD 전체 플로우 및 404 에러 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Test Category',
          description: 'Test Description',
          slug: 'test-category-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.literal('Test Category'),
          slug: z.string(),
          isActive: z.boolean(),
        }),
      },
      {
        id: 'get-category',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '생성된 카테고리 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.literal('Test Category'),
          description: z.string(),
        }),
      },
      {
        id: 'update-category',
        method: 'PUT',
        path: '/categories/{{categoryId}}',
        body: {
          name: 'Updated Category',
          description: 'Updated Description',
        },
        expectedStatus: 200,
        description: '카테고리 수정',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.literal('Updated Category'),
        }),
      },
      {
        id: 'delete-category',
        method: 'DELETE',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '카테고리 삭제',
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 404,
        description: '삭제된 카테고리 조회 (404 기대)',
      },
    ],
  },

  // ========================================
  // Scenario Group 2: Hierarchical Structure
  // ========================================
  {
    id: 'CAT-002',
    name: '부모-자식 카테고리 계층 구조',
    category: 'PIM > Category',
    validation: '계층 구조 생성 및 조회 확인',
    steps: [
      {
        id: 'create-parent',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Parent Category',
          slug: 'parent-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '부모 카테고리 생성',
        extractFromResponse: { parentId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          level: z.literal(0),
        }),
      },
      {
        id: 'create-child',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Child Category',
          slug: 'child-{{timestamp}}',
          parentId: '{{parentId}}',
        },
        expectedStatus: 201,
        description: '자식 카테고리 생성',
        extractFromResponse: { childId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          parentId: z.string().uuid(),
          level: z.number().min(1),
        }),
      },
      {
        id: 'get-children',
        method: 'GET',
        path: '/categories/{{parentId}}/children',
        expectedStatus: 200,
        description: '부모의 하위 카테고리 목록 조회',
      },
      {
        id: 'get-path',
        method: 'GET',
        path: '/categories/{{childId}}/path',
        expectedStatus: 200,
        description: '자식 카테고리 경로 조회',
        responseSchema: z.object({
          categoryId: z.string().uuid(),
          path: z.array(z.any()),
        }),
      },
      {
        id: 'get-tree',
        method: 'GET',
        path: '/categories',
        expectedStatus: 200,
        description: '카테고리 트리 조회',
      },
    ],
  },

  {
    id: 'CAT-003',
    name: '카테고리 이동 (Move)',
    category: 'PIM > Category',
    validation: '카테고리 이동 및 계층 재구성 확인',
    steps: [
      {
        id: 'create-parent1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Parent 1',
          slug: 'parent1-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '첫 번째 부모 카테고리 생성',
        extractFromResponse: { parent1Id: 'id' },
      },
      {
        id: 'create-parent2',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Parent 2',
          slug: 'parent2-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '두 번째 부모 카테고리 생성',
        extractFromResponse: { parent2Id: 'id' },
      },
      {
        id: 'create-child',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Child Category',
          slug: 'child-move-{{timestamp}}',
          parentId: '{{parent1Id}}',
        },
        expectedStatus: 201,
        description: 'Parent 1 하위에 자식 카테고리 생성',
        extractFromResponse: { childId: 'id' },
      },
      {
        id: 'move-to-parent2',
        method: 'PUT',
        path: '/categories/{{childId}}/move',
        queryParams: {
          newParentId: '{{parent2Id}}',
        },
        expectedStatus: 200,
        description: 'Parent 2로 카테고리 이동',
        responseSchema: z.object({
          id: z.string().uuid(),
          parentId: z.string().uuid(),
        }),
      },
      {
        id: 'move-to-root',
        method: 'PUT',
        path: '/categories/{{childId}}/move',
        expectedStatus: 200,
        description: '루트로 카테고리 이동 (newParentId 없음)',
      },
    ],
  },

  {
    id: 'CAT-004',
    name: '다단계 계층 생성 및 조회',
    category: 'PIM > Category',
    validation: '3단계 계층 구조 및 maxDepth 파라미터 확인',
    steps: [
      {
        id: 'create-level0',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Level 0',
          slug: 'level0-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Level 0 카테고리 생성',
        extractFromResponse: { level0Id: 'id' },
      },
      {
        id: 'create-level1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Level 1',
          slug: 'level1-{{timestamp}}',
          parentId: '{{level0Id}}',
        },
        expectedStatus: 201,
        description: 'Level 1 카테고리 생성',
        extractFromResponse: { level1Id: 'id' },
      },
      {
        id: 'create-level2',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Level 2',
          slug: 'level2-{{timestamp}}',
          parentId: '{{level1Id}}',
        },
        expectedStatus: 201,
        description: 'Level 2 카테고리 생성',
        responseSchema: z.object({
          id: z.string().uuid(),
          level: z.number().min(2),
        }),
      },
      {
        id: 'get-tree-depth-2',
        method: 'GET',
        path: '/categories',
        queryParams: {
          maxDepth: '2',
        },
        expectedStatus: 200,
        description: 'maxDepth=2로 트리 조회',
      },
      {
        id: 'get-tree-all',
        method: 'GET',
        path: '/categories',
        expectedStatus: 200,
        description: '전체 트리 조회',
      },
    ],
  },

  // ========================================
  // Scenario Group 3: Product Association
  // ========================================
  {
    id: 'CAT-005',
    name: '상품 카테고리 이동 (Move Products)',
    category: 'PIM > Category',
    validation: 'PUT /categories/:id/products로 상품 이동 확인',
    steps: [
      {
        id: 'create-category1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Category 1',
          slug: 'cat1-{{timestamp}}',
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
          name: 'Category 2',
          slug: 'cat2-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 2 생성',
        extractFromResponse: { category2Id: 'id' },
      },
      {
        id: 'create-product-master',
        method: 'POST',
        path: '/masters',
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'id', versionId: 'versions.0.id' },
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
        extractFromResponse: { publishedVersionId: 'id' },
      },
      {
        id: 'move-to-category1',
        method: 'PUT',
        path: '/categories/{{category1Id}}/products',
        body: {
          versionIds: ['{{publishedVersionId}}'],
        },
        expectedStatus: 200,
        description: '상품을 카테고리 1로 이동',
      },
      {
        id: 'move-to-category2',
        method: 'PUT',
        path: '/categories/{{category2Id}}/products',
        body: {
          versionIds: ['{{publishedVersionId}}'],
        },
        expectedStatus: 200,
        description: '상품을 카테고리 2로 이동 (카테고리 1에서 제거됨)',
      },
    ],
  },

  {
    id: 'CAT-006',
    name: '상품 카테고리 추가 (Add Products)',
    category: 'PIM > Category',
    validation: 'POST /categories/:id/products/add로 다중 카테고리 연결 확인',
    steps: [
      {
        id: 'create-category1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Category A',
          slug: 'cata-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 A 생성',
        extractFromResponse: { categoryAId: 'id' },
      },
      {
        id: 'create-category2',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Category B',
          slug: 'catb-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 B 생성',
        extractFromResponse: { categoryBId: 'id' },
      },
      {
        id: 'create-product-master',
        method: 'POST',
        path: '/masters',
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'id', versionId: 'versions.0.id' },
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
        extractFromResponse: { publishedVersionId: 'id' },
      },
      {
        id: 'add-to-categoryA',
        method: 'POST',
        path: '/categories/{{categoryAId}}/products/add',
        body: {
          versionIds: ['{{publishedVersionId}}'],
        },
        expectedStatus: 200,
        description: '상품을 카테고리 A에 추가',
      },
      {
        id: 'add-to-categoryB',
        method: 'POST',
        path: '/categories/{{categoryBId}}/products/add',
        body: {
          versionIds: ['{{publishedVersionId}}'],
        },
        expectedStatus: 200,
        description: '상품을 카테고리 B에도 추가 (A는 유지)',
      },
    ],
  },

  {
    id: 'CAT-007',
    name: '카테고리 삭제 시 상품 이동',
    category: 'PIM > Category',
    validation: 'DELETE with moveProductsTo 쿼리 파라미터 확인',
    steps: [
      {
        id: 'create-category1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Category To Delete',
          slug: 'cat-delete-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '삭제할 카테고리 생성',
        extractFromResponse: { category1Id: 'id' },
      },
      {
        id: 'create-category2',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Category Target',
          slug: 'cat-target-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '상품을 이동할 타겟 카테고리 생성',
        extractFromResponse: { category2Id: 'id' },
      },
      {
        id: 'create-product-master',
        method: 'POST',
        path: '/masters',
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'id', versionId: 'versions.0.id' },
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
        extractFromResponse: { publishedVersionId: 'id' },
      },
      {
        id: 'add-product-to-category1',
        method: 'POST',
        path: '/categories/{{category1Id}}/products/add',
        body: {
          versionIds: ['{{publishedVersionId}}'],
        },
        expectedStatus: 200,
        description: '상품을 삭제할 카테고리에 추가',
      },
      {
        id: 'delete-with-move',
        method: 'DELETE',
        path: '/categories/{{category1Id}}',
        queryParams: {
          moveProductsTo: '{{category2Id}}',
        },
        expectedStatus: 200,
        description: '카테고리 삭제하면서 상품을 category2로 이동',
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/categories/{{category1Id}}',
        expectedStatus: 404,
        description: '카테고리 삭제 확인',
      },
    ],
  },

  // ========================================
  // Scenario Group 4: Configuration Updates
  // ========================================
  {
    id: 'CAT-008',
    name: '카테고리 표시 설정 (Display Settings)',
    category: 'PIM > Category',
    validation: 'PATCH /categories/:id/display-settings 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Display Test Category',
          slug: 'display-test-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'update-display-settings',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/display-settings',
        body: {
          showOnMainCategory: true,
          pcAndMobile: true,
          menuPositions: {
            topMenu: true,
            leftSide: false,
            footerMenu: true,
          },
        },
        expectedStatus: 200,
        description: '표시 설정 업데이트',
      },
      {
        id: 'get-updated-category',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '업데이트된 카테고리 조회',
      },
      {
        id: 'update-display-settings-again',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/display-settings',
        body: {
          mobileOnly: true,
          menuPositions: {
            topMenu: false,
            leftSide: true,
          },
        },
        expectedStatus: 200,
        description: '표시 설정 재업데이트',
      },
    ],
  },

  {
    id: 'CAT-009',
    name: '카테고리 SEO 설정',
    category: 'PIM > Category',
    validation: 'PATCH /categories/:id/seo 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'SEO Test Category',
          slug: 'seo-test-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'update-seo',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/seo',
        body: {
          browserTitle: 'Test SEO Title',
          metaDescription: 'This is a test meta description',
          metaKeywords: ['test', 'seo', 'category'],
          showInSearchEngines: true,
        },
        expectedStatus: 200,
        description: 'SEO 설정 업데이트',
      },
      {
        id: 'get-category',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: 'SEO 설정 확인',
      },
      {
        id: 'hide-from-search-engines',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/seo',
        body: {
          showInSearchEngines: false,
        },
        expectedStatus: 200,
        description: '검색 엔진 노출 숨김',
      },
    ],
  },

  {
    id: 'CAT-010',
    name: '카테고리 템플릿 설정',
    category: 'PIM > Category',
    validation: 'PATCH /categories/:id/template 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Template Test Category',
          slug: 'template-test-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'set-custom-template',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/template',
        body: {
          templateType: 'custom',
          htmlContent: '<div>Custom Template HTML</div>',
          customCss: '.custom { color: red; }',
        },
        expectedStatus: 200,
        description: '커스텀 템플릿 설정',
      },
      {
        id: 'get-category',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '템플릿 설정 확인',
      },
      {
        id: 'reset-to-default',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/template',
        body: {
          templateType: 'default',
        },
        expectedStatus: 200,
        description: '기본 템플릿으로 복원',
      },
    ],
  },

  {
    id: 'CAT-011',
    name: '카테고리 표시 여부 (Visibility)',
    category: 'PIM > Category',
    validation: 'PATCH /categories/:id/visibility 확인',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Visibility Test Category',
          slug: 'visibility-test-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'hide-category',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/visibility',
        body: {
          visible: false,
        },
        expectedStatus: 200,
        description: '카테고리 숨김',
      },
      {
        id: 'get-hidden-category',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '숨겨진 카테고리 조회',
      },
      {
        id: 'show-category',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/visibility',
        body: {
          visible: true,
        },
        expectedStatus: 200,
        description: '카테고리 다시 표시',
      },
    ],
  },

  // ========================================
  // Scenario Group 5: Tag Group Management
  // ========================================
  {
    id: 'CAT-012',
    name: '카테고리 태그 그룹 연결',
    category: 'PIM > Category',
    validation: 'PUT /categories/:id/tag-groups 및 GET 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: 'Test Tag Group {{timestamp}}',
          description: 'Test tag group for category',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { tagGroupId: 'id' },
      },
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Tag Test Category',
          slug: 'tag-test-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'link-tag-group',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        body: {
          links: [
            {
              tagGroupId: '{{tagGroupId}}',
              displayOrder: 0,
              isRequired: true,
              appliesToDescendants: false,
            },
          ],
        },
        expectedStatus: 204,
        description: '태그 그룹을 카테고리에 연결',
      },
      {
        id: 'get-tag-groups',
        method: 'GET',
        path: '/categories/{{categoryId}}/tag-groups',
        expectedStatus: 200,
        description: '카테고리의 태그 그룹 조회',
        responseSchema: z.object({
          categoryId: z.string().uuid(),
          categoryName: z.string(),
          tagGroups: z.array(z.any()),
        }),
      },
    ],
  },

  {
    id: 'CAT-013',
    name: '태그 그룹 상속 (Descendants)',
    category: 'PIM > Category',
    validation: 'appliesToDescendants 플래그 및 상속 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: 'Inherited Tag Group {{timestamp}}',
          description: 'Tag group for inheritance test',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { tagGroupId: 'id' },
      },
      {
        id: 'create-parent-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Parent for Inheritance',
          slug: 'parent-inherit-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '부모 카테고리 생성',
        extractFromResponse: { parentId: 'id' },
      },
      {
        id: 'create-child-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Child for Inheritance',
          slug: 'child-inherit-{{timestamp}}',
          parentId: '{{parentId}}',
        },
        expectedStatus: 201,
        description: '자식 카테고리 생성',
        extractFromResponse: { childId: 'id' },
      },
      {
        id: 'link-tag-group-with-inheritance',
        method: 'PUT',
        path: '/categories/{{parentId}}/tag-groups',
        body: {
          links: [
            {
              tagGroupId: '{{tagGroupId}}',
              displayOrder: 0,
              isRequired: false,
              appliesToDescendants: true,
            },
          ],
        },
        expectedStatus: 204,
        description: '부모에 태그 그룹 연결 (하위 카테고리에 적용)',
      },
      {
        id: 'get-child-tag-groups',
        method: 'GET',
        path: '/categories/{{childId}}/tag-groups',
        expectedStatus: 200,
        description: '자식 카테고리의 태그 그룹 조회 (상속 확인)',
      },
    ],
  },

  {
    id: 'CAT-014',
    name: '태그 그룹 교체',
    category: 'PIM > Category',
    validation: 'PUT으로 기존 태그 그룹 완전 교체 확인',
    steps: [
      {
        id: 'create-tag-group1',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: 'Tag Group 1 {{timestamp}}',
        },
        expectedStatus: 201,
        description: '첫 번째 태그 그룹 생성',
        extractFromResponse: { tagGroup1Id: 'id' },
      },
      {
        id: 'create-tag-group2',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: 'Tag Group 2 {{timestamp}}',
        },
        expectedStatus: 201,
        description: '두 번째 태그 그룹 생성',
        extractFromResponse: { tagGroup2Id: 'id' },
      },
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Tag Replace Test',
          slug: 'tag-replace-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'link-tag-group1',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        body: {
          links: [
            {
              tagGroupId: '{{tagGroup1Id}}',
              displayOrder: 0,
            },
          ],
        },
        expectedStatus: 204,
        description: '태그 그룹 1 연결',
      },
      {
        id: 'replace-with-tag-group2',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        body: {
          links: [
            {
              tagGroupId: '{{tagGroup2Id}}',
              displayOrder: 0,
            },
          ],
        },
        expectedStatus: 204,
        description: '태그 그룹 2로 완전 교체',
      },
      {
        id: 'verify-replacement',
        method: 'GET',
        path: '/categories/{{categoryId}}/tag-groups',
        expectedStatus: 200,
        description: '교체 확인 (태그 그룹 2만 존재)',
      },
    ],
  },

  // ========================================
  // Scenario Group 6: Error Cases
  // ========================================
  {
    id: 'CAT-015',
    name: '중복 Slug 생성 시도',
    category: 'PIM > Category',
    validation: '중복 slug로 409 Conflict 에러 확인',
    steps: [
      {
        id: 'create-category1',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'First Category',
          slug: 'duplicate-slug-test',
        },
        expectedStatus: 201,
        description: '첫 번째 카테고리 생성',
        extractFromResponse: { category1Id: 'id' },
      },
      {
        id: 'create-duplicate-slug',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Second Category',
          slug: 'duplicate-slug-test',
        },
        expectedStatus: 409,
        description: '동일한 slug로 생성 시도 (409 예상)',
      },
    ],
  },

  {
    id: 'CAT-016',
    name: '존재하지 않는 부모 참조',
    category: 'PIM > Category',
    validation: '잘못된 parentId로 404 에러 확인',
    steps: [
      {
        id: 'create-with-invalid-parent',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Invalid Parent Test',
          slug: 'invalid-parent-{{timestamp}}',
          parentId: '00000000-0000-0000-0000-000000000000',
        },
        expectedStatus: 404,
        description: '존재하지 않는 부모 ID로 생성 시도 (404 예상)',
      },
    ],
  },

  {
    id: 'CAT-017',
    name: '순환 참조 방지 (Circular Move)',
    category: 'PIM > Category',
    validation: '부모를 자식 하위로 이동 시도 시 400 에러 확인',
    steps: [
      {
        id: 'create-parent',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Circular Parent',
          slug: 'circular-parent-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '부모 카테고리 생성',
        extractFromResponse: { parentId: 'id' },
      },
      {
        id: 'create-child',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Circular Child',
          slug: 'circular-child-{{timestamp}}',
          parentId: '{{parentId}}',
        },
        expectedStatus: 201,
        description: '자식 카테고리 생성',
        extractFromResponse: { childId: 'id' },
      },
      {
        id: 'attempt-circular-move',
        method: 'PUT',
        path: '/categories/{{parentId}}/move',
        queryParams: {
          newParentId: '{{childId}}',
        },
        expectedStatus: 400,
        description: '부모를 자식 하위로 이동 시도 (400 예상)',
      },
    ],
  },

  {
    id: 'CAT-018',
    name: '자식이 있는 카테고리 삭제 시도',
    category: 'PIM > Category',
    validation: '자식이 있는 카테고리 삭제 시 400 에러 확인',
    steps: [
      {
        id: 'create-parent',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Parent with Child',
          slug: 'parent-with-child-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '부모 카테고리 생성',
        extractFromResponse: { parentId: 'id' },
      },
      {
        id: 'create-child',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Child Category',
          slug: 'child-prevent-delete-{{timestamp}}',
          parentId: '{{parentId}}',
        },
        expectedStatus: 201,
        description: '자식 카테고리 생성',
      },
      {
        id: 'attempt-delete-parent',
        method: 'DELETE',
        path: '/categories/{{parentId}}',
        expectedStatus: 400,
        description: '자식이 있는 부모 삭제 시도 (400 예상)',
      },
    ],
  },

  // ========================================
  // Scenario Group 7: Complex Workflows
  // ========================================
  {
    id: 'CAT-019',
    name: '전체 카테고리 설정 워크플로우',
    category: 'PIM > Category',
    validation: '모든 설정 엔드포인트 종합 테스트',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: 'Full Workflow Tag {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { tagGroupId: 'id' },
      },
      {
        id: 'create-product-master',
        method: 'POST',
        path: '/masters',
        expectedStatus: 201,
        description: '상품 마스터 생성',
        extractFromResponse: { masterId: 'id', versionId: 'versions.0.id' },
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish',
        extractFromResponse: { publishedVersionId: 'id' },
      },
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Full Config Category',
          slug: 'full-config-{{timestamp}}',
          description: 'Category with all configurations',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'update-display',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/display-settings',
        body: {
          showOnMainCategory: true,
          menuPositions: {
            topMenu: true,
            leftSide: true,
          },
        },
        expectedStatus: 200,
        description: '표시 설정 업데이트',
      },
      {
        id: 'update-seo',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/seo',
        body: {
          browserTitle: 'Full Config SEO Title',
          metaDescription: 'SEO optimized description',
          showInSearchEngines: true,
        },
        expectedStatus: 200,
        description: 'SEO 설정 업데이트',
      },
      {
        id: 'update-template',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/template',
        body: {
          templateType: 'custom',
          htmlContent: '<div>Full workflow template</div>',
        },
        expectedStatus: 200,
        description: '템플릿 설정 업데이트',
      },
      {
        id: 'update-visibility',
        method: 'PATCH',
        path: '/categories/{{categoryId}}/visibility',
        body: {
          visible: true,
        },
        expectedStatus: 200,
        description: '표시 여부 업데이트',
      },
      {
        id: 'link-tag-groups',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        body: {
          links: [
            {
              tagGroupId: '{{tagGroupId}}',
              displayOrder: 0,
              isRequired: true,
            },
          ],
        },
        expectedStatus: 204,
        description: '태그 그룹 연결',
      },
      {
        id: 'add-products',
        method: 'POST',
        path: '/categories/{{categoryId}}/products/add',
        body: {
          versionIds: ['{{publishedVersionId}}'],
        },
        expectedStatus: 200,
        description: '상품 추가',
      },
      {
        id: 'get-detail',
        method: 'GET',
        path: '/categories/{{categoryId}}',
        expectedStatus: 200,
        description: '전체 설정 확인',
      },
      {
        id: 'get-tag-groups',
        method: 'GET',
        path: '/categories/{{categoryId}}/tag-groups',
        expectedStatus: 200,
        description: '태그 그룹 확인',
      },
      {
        id: 'get-children',
        method: 'GET',
        path: '/categories/{{categoryId}}/children',
        expectedStatus: 200,
        description: '하위 카테고리 확인 (비어 있음)',
      },
      {
        id: 'get-path',
        method: 'GET',
        path: '/categories/{{categoryId}}/path',
        expectedStatus: 200,
        description: '경로 확인',
      },
    ],
  },

  {
    id: 'CAT-020',
    name: '카테고리 재구성 (Reorganization)',
    category: 'PIM > Category',
    validation: '복잡한 계층 재구성 및 상품 이동 워크플로우',
    steps: [
      {
        id: 'create-electronics',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Electronics',
          slug: 'electronics-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Electronics 카테고리 생성',
        extractFromResponse: { electronicsId: 'id' },
      },
      {
        id: 'create-computers',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Computers',
          slug: 'computers-{{timestamp}}',
          parentId: '{{electronicsId}}',
        },
        expectedStatus: 201,
        description: 'Computers 카테고리 생성 (Electronics 하위)',
        extractFromResponse: { computersId: 'id' },
      },
      {
        id: 'create-phones',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'Phones',
          slug: 'phones-{{timestamp}}',
          parentId: '{{electronicsId}}',
        },
        expectedStatus: 201,
        description: 'Phones 카테고리 생성 (Electronics 하위)',
      },
      {
        id: 'create-product1',
        method: 'POST',
        path: '/masters',
        expectedStatus: 201,
        description: '첫 번째 상품 마스터 생성',
        extractFromResponse: { master1Id: 'id', version1Id: 'versions.0.id' },
      },
      {
        id: 'publish-version1',
        method: 'PATCH',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '첫 번째 버전 Publish',
        extractFromResponse: { publishedVersion1Id: 'id' },
      },
      {
        id: 'create-product2',
        method: 'POST',
        path: '/masters',
        expectedStatus: 201,
        description: '두 번째 상품 마스터 생성',
        extractFromResponse: { master2Id: 'id', version2Id: 'versions.0.id' },
      },
      {
        id: 'publish-version2',
        method: 'PATCH',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: '두 번째 버전 Publish',
        extractFromResponse: { publishedVersion2Id: 'id' },
      },
      {
        id: 'add-products-to-computers',
        method: 'POST',
        path: '/categories/{{computersId}}/products/add',
        body: {
          versionIds: ['{{publishedVersion1Id}}', '{{publishedVersion2Id}}'],
        },
        expectedStatus: 200,
        description: '상품들을 Computers 카테고리에 추가',
      },
      {
        id: 'create-it',
        method: 'POST',
        path: '/categories',
        body: {
          name: 'IT',
          slug: 'it-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'IT 카테고리 생성 (루트)',
        extractFromResponse: { itId: 'id' },
      },
      {
        id: 'move-computers-to-it',
        method: 'PUT',
        path: '/categories/{{computersId}}/move',
        queryParams: {
          newParentId: '{{itId}}',
        },
        expectedStatus: 200,
        description: 'Computers를 IT 하위로 이동',
      },
      {
        id: 'move-products-to-electronics',
        method: 'PUT',
        path: '/categories/{{electronicsId}}/products',
        body: {
          versionIds: ['{{publishedVersion1Id}}', '{{publishedVersion2Id}}'],
        },
        expectedStatus: 200,
        description: '상품들을 Electronics로 이동',
      },
      {
        id: 'get-final-tree',
        method: 'GET',
        path: '/categories',
        expectedStatus: 200,
        description: '최종 트리 구조 확인',
      },
    ],
  },
];
