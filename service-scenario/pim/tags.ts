import { z } from 'zod';
import type { Scenario } from '../types.ts';

/**
 * PIM Tags API Test Scenarios
 *
 * Coverage: 13 endpoints
 * - Tag Groups: POST, GET, GET/:id, GET/:id/detail, PUT/:id, DELETE/:id
 * - Tag Values: POST, GET (by group), GET/:id, PUT/:id, DELETE/:id
 * - Category-Tag: PUT, GET
 *
 * Total Scenarios: 14
 */

export const tagScenarios: Scenario[] = [
  // ========================================
  // Group 1: Tag Group CRUD (TAG-001 ~ TAG-003)
  // ========================================
  {
    id: 'TAG-001',
    name: '태그 그룹 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Tags',
    validation: '태그 그룹 전체 CRUD 플로우 및 soft delete 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Color {{timestamp}}',
          description: 'Product color tags',
          displayOrder: 10,
          isActive: true,
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { groupId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          description: z.string(),
          displayOrder: z.literal(10),
          isActive: z.literal(true),
          valuesCount: z.literal(0),
        }),
      },
      {
        id: 'get-tag-group',
        method: 'GET',
        path: '/tags/groups/{{groupId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '태그 그룹 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          displayOrder: z.literal(10),
          valuesCount: z.number(),
        }),
      },
      {
        id: 'update-tag-group',
        method: 'PUT',
        path: '/tags/groups/{{groupId}}',
        service: 'pim',
        body: {
          name: 'Updated Color {{timestamp}}',
          displayOrder: 20,
        },
        expectedStatus: 200,
        description: '태그 그룹 수정',
        responseSchema: z.object({
          name: z.string(),
          displayOrder: z.literal(20),
        }),
      },
      {
        id: 'soft-delete-tag-group',
        method: 'DELETE',
        path: '/tags/groups/{{groupId}}',
        service: 'pim',
        expectedStatus: 204,
        description: '태그 그룹 soft delete',
      },
      {
        id: 'verify-inactive',
        method: 'GET',
        path: '/tags/groups/{{groupId}}',
        service: 'pim',
        expectedStatus: 200,
        description: 'Soft delete 확인 (isActive=false)',
        responseSchema: z.object({
          isActive: z.literal(false),
        }),
      },
    ],
  },

  {
    id: 'TAG-002',
    name: '태그 그룹 목록 조회 및 필터링',
    category: 'PIM > Tags',
    validation: '목록 조회, isActive 필터, displayOrder 정렬 확인',
    steps: [
      {
        id: 'create-group-1',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Size {{timestamp}}',
          displayOrder: 5,
          isActive: true,
        },
        expectedStatus: 201,
        description: '태그 그룹 1 생성 (active)',
        extractFromResponse: { group1Id: 'id' },
      },
      {
        id: 'create-group-2',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Weight {{timestamp}}',
          displayOrder: 10,
          isActive: false,
        },
        expectedStatus: 201,
        description: '태그 그룹 2 생성 (inactive)',
        extractFromResponse: { group2Id: 'id' },
      },
      {
        id: 'list-all-groups',
        method: 'GET',
        path: '/tags/groups',
        service: 'pim',
        expectedStatus: 200,
        description: '전체 태그 그룹 목록 조회',
        responseSchema: z.array(z.any()),
      },
      {
        id: 'list-active-groups',
        method: 'GET',
        path: '/tags/groups',
        service: 'pim',
        queryParams: {
          isActive: 'true',
        },
        expectedStatus: 200,
        description: 'Active 태그 그룹만 조회',
        responseSchema: z.array(z.any()),
      },
      {
        id: 'list-inactive-groups',
        method: 'GET',
        path: '/tags/groups',
        service: 'pim',
        queryParams: {
          isActive: 'false',
        },
        expectedStatus: 200,
        description: 'Inactive 태그 그룹만 조회',
        responseSchema: z.array(z.any()),
      },
    ],
  },

  {
    id: 'TAG-003',
    name: '태그 그룹 상세 조회 (값 포함)',
    category: 'PIM > Tags',
    validation: 'GET /tags/groups/:id/detail endpoint 및 values 배열 검증',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Material {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { groupId: 'id' },
      },
      {
        id: 'create-value-1',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Cotton',
          displayOrder: 0,
        },
        expectedStatus: 201,
        description: '태그 값 1 생성',
      },
      {
        id: 'create-value-2',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Polyester',
          displayOrder: 1,
        },
        expectedStatus: 201,
        description: '태그 값 2 생성',
      },
      {
        id: 'create-value-3',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Silk',
          displayOrder: 2,
          isActive: false,
        },
        expectedStatus: 201,
        description: '태그 값 3 생성 (inactive)',
      },
      {
        id: 'get-group-detail',
        method: 'GET',
        path: '/tags/groups/{{groupId}}/detail',
        service: 'pim',
        expectedStatus: 200,
        description: '태그 그룹 상세 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          values: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              displayOrder: z.number(),
            }),
          ).length(2),
        }),
      },
    ],
  },

  // ========================================
  // Group 2: Tag Value CRUD (TAG-004 ~ TAG-006)
  // ========================================
  {
    id: 'TAG-004',
    name: '태그 값 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Tags',
    validation: '태그 값 전체 CRUD 플로우 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Brand {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { groupId: 'id' },
      },
      {
        id: 'create-tag-value',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Nike',
          displayOrder: 0,
        },
        expectedStatus: 201,
        description: '태그 값 생성',
        extractFromResponse: { valueId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          groupId: z.string().uuid(),
          name: z.literal('Nike'),
          displayOrder: z.literal(0),
          isActive: z.literal(true),
        }),
      },
      {
        id: 'get-tag-value',
        method: 'GET',
        path: '/tags/values/{{valueId}}',
        service: 'pim',
        expectedStatus: 200,
        description: '태그 값 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.literal('Nike'),
          groupName: z.string(),
        }),
      },
      {
        id: 'update-tag-value',
        method: 'PUT',
        path: '/tags/values/{{valueId}}',
        service: 'pim',
        body: {
          name: 'Nike Pro',
          displayOrder: 5,
        },
        expectedStatus: 200,
        description: '태그 값 수정',
        responseSchema: z.object({
          name: z.literal('Nike Pro'),
          displayOrder: z.literal(5),
        }),
      },
      {
        id: 'soft-delete-tag-value',
        method: 'DELETE',
        path: '/tags/values/{{valueId}}',
        service: 'pim',
        expectedStatus: 204,
        description: '태그 값 soft delete',
      },
      {
        id: 'verify-value-inactive',
        method: 'GET',
        path: '/tags/values/{{valueId}}',
        service: 'pim',
        expectedStatus: 200,
        description: 'Soft delete 확인',
        responseSchema: z.object({
          isActive: z.literal(false),
        }),
      },
    ],
  },

  {
    id: 'TAG-005',
    name: '태그 값 목록 조회 (그룹별)',
    category: 'PIM > Tags',
    validation: 'GET /tags/groups/:groupId/values endpoint 및 정렬 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Season {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { groupId: 'id' },
      },
      {
        id: 'create-value-winter',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Winter',
          displayOrder: 3,
        },
        expectedStatus: 201,
        description: '태그 값 Winter 생성',
      },
      {
        id: 'create-value-summer',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Summer',
          displayOrder: 1,
        },
        expectedStatus: 201,
        description: '태그 값 Summer 생성',
      },
      {
        id: 'create-value-spring',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Spring',
          displayOrder: 2,
        },
        expectedStatus: 201,
        description: '태그 값 Spring 생성',
      },
      {
        id: 'create-value-fall',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Fall',
          displayOrder: 4,
          isActive: false,
        },
        expectedStatus: 201,
        description: '태그 값 Fall 생성 (inactive)',
      },
      {
        id: 'list-values-by-group',
        method: 'GET',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        expectedStatus: 200,
        description: '그룹별 태그 값 목록 조회',
        responseSchema: z.array(
          z.object({
            name: z.string(),
            displayOrder: z.number(),
          }),
        ).length(3),
      },
    ],
  },

  {
    id: 'TAG-006',
    name: '태그 값 중복 이름 검증',
    category: 'PIM > Tags',
    validation: '동일 그룹 내 중복 이름 생성/수정 시 400 에러 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Style {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { groupId: 'id' },
      },
      {
        id: 'create-value-casual',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Casual',
        },
        expectedStatus: 201,
        description: '태그 값 Casual 생성',
        extractFromResponse: { casualId: 'id' },
      },
      {
        id: 'create-value-formal',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Formal',
        },
        expectedStatus: 201,
        description: '태그 값 Formal 생성',
        extractFromResponse: { formalId: 'id' },
      },
      {
        id: 'error-duplicate-create',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Casual',
        },
        expectedStatus: 400,
        description: '중복 이름으로 생성 시도 (400 에러)',
      },
      {
        id: 'error-duplicate-update',
        method: 'PUT',
        path: '/tags/values/{{formalId}}',
        service: 'pim',
        body: {
          name: 'Casual',
        },
        expectedStatus: 400,
        description: '중복 이름으로 수정 시도 (400 에러)',
      },
    ],
  },

  // ========================================
  // Group 3: Tag Group-Value 관계 (TAG-007 ~ TAG-008)
  // ========================================
  {
    id: 'TAG-007',
    name: '태그 값이 있는 그룹 삭제 불가',
    category: 'PIM > Tags',
    validation: 'DELETE tag group with values → expect 400 error',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Texture {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 생성',
        extractFromResponse: { groupId: 'id' },
      },
      {
        id: 'create-tag-value',
        method: 'POST',
        path: '/tags/groups/{{groupId}}/values',
        service: 'pim',
        body: {
          name: 'Smooth',
        },
        expectedStatus: 201,
        description: '태그 값 생성',
        extractFromResponse: { valueId: 'id' },
      },
      {
        id: 'error-delete-group-with-values',
        method: 'DELETE',
        path: '/tags/groups/{{groupId}}',
        service: 'pim',
        expectedStatus: 400,
        description: '값이 있는 그룹 삭제 시도 (400 에러)',
      },
      {
        id: 'delete-tag-value',
        method: 'DELETE',
        path: '/tags/values/{{valueId}}',
        service: 'pim',
        expectedStatus: 204,
        description: '태그 값 삭제',
      },
      {
        id: 'success-delete-group',
        method: 'DELETE',
        path: '/tags/groups/{{groupId}}',
        service: 'pim',
        expectedStatus: 204,
        description: '값 삭제 후 그룹 삭제 성공',
      },
    ],
  },

  {
    id: 'TAG-008',
    name: '존재하지 않는 그룹에 태그 값 생성',
    category: 'PIM > Tags',
    validation: 'POST tag value to non-existent group → expect 404',
    steps: [
      {
        id: 'error-create-value-invalid-group',
        method: 'POST',
        path: '/tags/groups/00000000-0000-0000-0000-000000000000/values',
        service: 'pim',
        body: {
          name: 'Test Value',
        },
        expectedStatus: 404,
        description: '존재하지 않는 그룹에 값 생성 시도 (404 에러)',
      },
    ],
  },

  // ========================================
  // Group 4: Category-Tag 연결 (TAG-009 ~ TAG-012)
  // ========================================
  {
    id: 'TAG-009',
    name: '카테고리에 태그 그룹 연결 설정',
    category: 'PIM > Tags',
    validation: 'PUT category tag groups → replace links',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Electronics {{timestamp}}',
          slug: 'electronics-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'create-tag-group-color',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Color {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 Color 생성',
        extractFromResponse: { colorGroupId: 'id' },
      },
      {
        id: 'create-tag-group-size',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Size {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 Size 생성',
        extractFromResponse: { sizeGroupId: 'id' },
      },
      {
        id: 'create-tag-group-material',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Material {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 Material 생성',
        extractFromResponse: { materialGroupId: 'id' },
      },
      {
        id: 'set-category-tag-groups',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{colorGroupId}}',
              displayOrder: 0,
              isRequired: true,
              appliesToDescendants: false,
            },
            {
              tagGroupId: '{{sizeGroupId}}',
              displayOrder: 1,
              isRequired: false,
              appliesToDescendants: true,
            },
          ],
        },
        expectedStatus: 204,
        description: '카테고리 태그 그룹 연결 설정',
      },
      {
        id: 'verify-category-tag-groups',
        method: 'GET',
        path: '/categories/{{categoryId}}/tag-groups',
        service: 'pim',
        expectedStatus: 200,
        description: '카테고리 태그 그룹 조회',
        responseSchema: z.object({
          categoryId: z.string().uuid(),
          tagGroups: z.array(z.any()).length(2),
        }),
      },
      {
        id: 'replace-category-tag-groups',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{materialGroupId}}',
              displayOrder: 0,
            },
          ],
        },
        expectedStatus: 204,
        description: '카테고리 태그 그룹 교체',
      },
      {
        id: 'verify-replaced-tag-groups',
        method: 'GET',
        path: '/categories/{{categoryId}}/tag-groups',
        service: 'pim',
        expectedStatus: 200,
        description: '교체된 태그 그룹 확인',
        responseSchema: z.object({
          tagGroups: z.array(z.any()).length(1),
        }),
      },
    ],
  },

  {
    id: 'TAG-010',
    name: '카테고리 태그 그룹 상속 확인',
    category: 'PIM > Tags',
    validation: 'Parent category tag groups with appliesToDescendants=true are inherited by children',
    steps: [
      {
        id: 'create-parent-category',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Fashion {{timestamp}}',
          slug: 'fashion-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '부모 카테고리 생성',
        extractFromResponse: { parentCategoryId: 'id' },
      },
      {
        id: 'create-child-category',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'T-Shirts {{timestamp}}',
          slug: 'tshirts-{{timestamp}}',
          parentId: '{{parentCategoryId}}',
        },
        expectedStatus: 201,
        description: '자식 카테고리 생성',
        extractFromResponse: { childCategoryId: 'id' },
      },
      {
        id: 'create-tag-group-gender',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Gender {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 Gender 생성',
        extractFromResponse: { genderGroupId: 'id' },
      },
      {
        id: 'create-gender-values',
        method: 'POST',
        path: '/tags/groups/{{genderGroupId}}/values',
        service: 'pim',
        body: {
          name: 'Men',
        },
        expectedStatus: 201,
        description: '태그 값 Men 생성',
      },
      {
        id: 'create-tag-group-age',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Age Group {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 Age Group 생성',
        extractFromResponse: { ageGroupId: 'id' },
      },
      {
        id: 'set-parent-tag-groups',
        method: 'PUT',
        path: '/categories/{{parentCategoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{genderGroupId}}',
              isRequired: true,
              appliesToDescendants: true,
            },
            {
              tagGroupId: '{{ageGroupId}}',
              appliesToDescendants: false,
            },
          ],
        },
        expectedStatus: 204,
        description: '부모 카테고리 태그 그룹 설정',
      },
      {
        id: 'get-child-tag-groups',
        method: 'GET',
        path: '/categories/{{childCategoryId}}/tag-groups',
        service: 'pim',
        expectedStatus: 200,
        description: '자식 카테고리 태그 그룹 조회 (상속 확인)',
        responseSchema: z.object({
          tagGroups: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              isInherited: z.boolean(),
              inheritedFromCategoryId: z.string().optional().nullable(),
              values: z.array(z.any()),
            }),
          ),
        }),
      },
    ],
  },

  {
    id: 'TAG-011',
    name: '카테고리 태그 그룹 다층 상속',
    category: 'PIM > Tags',
    validation: 'Multi-level inheritance (grandparent → parent → child)',
    steps: [
      {
        id: 'create-grandparent',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Products {{timestamp}}',
          slug: 'products-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Grandparent 카테고리 생성',
        extractFromResponse: { grandparentId: 'id' },
      },
      {
        id: 'create-parent',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Apparel {{timestamp}}',
          slug: 'apparel-{{timestamp}}',
          parentId: '{{grandparentId}}',
        },
        expectedStatus: 201,
        description: 'Parent 카테고리 생성',
        extractFromResponse: { parentId: 'id' },
      },
      {
        id: 'create-child',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Shirts {{timestamp}}',
          slug: 'shirts-{{timestamp}}',
          parentId: '{{parentId}}',
        },
        expectedStatus: 201,
        description: 'Child 카테고리 생성',
        extractFromResponse: { childId: 'id' },
      },
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Certification {{timestamp}}',
        },
        expectedStatus: 201,
        description: '태그 그룹 Certification 생성',
        extractFromResponse: { certGroupId: 'id' },
      },
      {
        id: 'set-grandparent-tag-groups',
        method: 'PUT',
        path: '/categories/{{grandparentId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{certGroupId}}',
              appliesToDescendants: true,
            },
          ],
        },
        expectedStatus: 204,
        description: 'Grandparent 태그 그룹 설정 (상속)',
      },
      {
        id: 'get-child-inherited-tags',
        method: 'GET',
        path: '/categories/{{childId}}/tag-groups',
        service: 'pim',
        expectedStatus: 200,
        description: 'Child에서 grandparent 태그 상속 확인',
        responseSchema: z.object({
          tagGroups: z.array(
            z.object({
              id: z.string(),
              isInherited: z.literal(true),
              inheritedFromCategoryId: z.string(),
            }),
          ),
        }),
      },
    ],
  },

  {
    id: 'TAG-012',
    name: '존재하지 않는 태그 그룹 연결 시도',
    category: 'PIM > Tags',
    validation: 'PUT category tag groups with invalid tagGroupId → expect 400/404',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Test Category {{timestamp}}',
          slug: 'test-category-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '카테고리 생성',
        extractFromResponse: { categoryId: 'id' },
      },
      {
        id: 'error-invalid-tag-group-id',
        method: 'PUT',
        path: '/categories/{{categoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '00000000-0000-0000-0000-000000000000',
            },
          ],
        },
        expectedStatus: 400,
        description: '존재하지 않는 태그 그룹 연결 시도 (400/404 에러)',
      },
    ],
  },

  // ========================================
  // Group 5: 고급 시나리오 (TAG-013 ~ TAG-014)
  // ========================================
  {
    id: 'TAG-013',
    name: '복합 시나리오 - 완전한 태그 시스템 구축',
    category: 'PIM > Tags',
    validation: '전체 태그 시스템의 엔드투엔드 플로우',
    steps: [
      {
        id: 'create-group-color',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Color {{timestamp}}',
          displayOrder: 0,
        },
        expectedStatus: 201,
        description: '태그 그룹 Color 생성',
        extractFromResponse: { colorGroupId: 'id' },
      },
      {
        id: 'create-group-size',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Size {{timestamp}}',
          displayOrder: 1,
        },
        expectedStatus: 201,
        description: '태그 그룹 Size 생성',
        extractFromResponse: { sizeGroupId: 'id' },
      },
      {
        id: 'create-group-material',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Material {{timestamp}}',
          displayOrder: 2,
        },
        expectedStatus: 201,
        description: '태그 그룹 Material 생성',
        extractFromResponse: { materialGroupId: 'id' },
      },
      {
        id: 'add-color-values',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        service: 'pim',
        body: {
          name: 'Red',
          displayOrder: 0,
        },
        expectedStatus: 201,
        description: 'Color 값 Red 추가',
        extractFromResponse: { redValueId: 'id' },
      },
      {
        id: 'add-color-blue',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        service: 'pim',
        body: {
          name: 'Blue',
          displayOrder: 1,
        },
        expectedStatus: 201,
        description: 'Color 값 Blue 추가',
        extractFromResponse: { blueValueId: 'id' },
      },
      {
        id: 'add-color-green',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        service: 'pim',
        body: {
          name: 'Green',
          displayOrder: 2,
        },
        expectedStatus: 201,
        description: 'Color 값 Green 추가',
      },
      {
        id: 'list-all-groups',
        method: 'GET',
        path: '/tags/groups',
        service: 'pim',
        expectedStatus: 200,
        description: '전체 태그 그룹 목록 조회',
        responseSchema: z.array(z.any()).min(3),
      },
      {
        id: 'get-color-detail',
        method: 'GET',
        path: '/tags/groups/{{colorGroupId}}/detail',
        service: 'pim',
        expectedStatus: 200,
        description: 'Color 그룹 상세 조회',
        responseSchema: z.object({
          values: z.array(z.any()).length(3),
        }),
      },
      {
        id: 'create-parent-category',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Parent {{timestamp}}',
          slug: 'parent-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '부모 카테고리 생성',
        extractFromResponse: { parentCategoryId: 'id' },
      },
      {
        id: 'create-child-category',
        method: 'POST',
        path: '/categories',
        service: 'pim',
        body: {
          name: 'Child {{timestamp}}',
          slug: 'child-{{timestamp}}',
          parentId: '{{parentCategoryId}}',
        },
        expectedStatus: 201,
        description: '자식 카테고리 생성',
        extractFromResponse: { childCategoryId: 'id' },
      },
      {
        id: 'link-color-to-parent',
        method: 'PUT',
        path: '/categories/{{parentCategoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{colorGroupId}}',
              isRequired: true,
              appliesToDescendants: true,
            },
          ],
        },
        expectedStatus: 204,
        description: '부모에 Color 그룹 연결 (상속)',
      },
      {
        id: 'link-size-to-parent',
        method: 'PUT',
        path: '/categories/{{parentCategoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{colorGroupId}}',
              appliesToDescendants: true,
            },
            {
              tagGroupId: '{{sizeGroupId}}',
              appliesToDescendants: false,
            },
          ],
        },
        expectedStatus: 204,
        description: '부모에 Size 그룹 추가 (비상속)',
      },
      {
        id: 'verify-child-inheritance',
        method: 'GET',
        path: '/categories/{{childCategoryId}}/tag-groups',
        service: 'pim',
        expectedStatus: 200,
        description: '자식 카테고리에서 Color만 상속 확인',
        responseSchema: z.object({
          tagGroups: z.array(z.any()).min(1),
        }),
      },
      {
        id: 'update-red-to-crimson',
        method: 'PUT',
        path: '/tags/values/{{redValueId}}',
        service: 'pim',
        body: {
          name: 'Crimson',
        },
        expectedStatus: 200,
        description: 'Red를 Crimson으로 수정',
      },
      {
        id: 'delete-blue-value',
        method: 'DELETE',
        path: '/tags/values/{{blueValueId}}',
        service: 'pim',
        expectedStatus: 204,
        description: 'Blue 값 삭제',
      },
      {
        id: 'verify-color-values',
        method: 'GET',
        path: '/tags/groups/{{colorGroupId}}/detail',
        service: 'pim',
        expectedStatus: 200,
        description: 'Color 그룹 값 확인 (Crimson, Green만)',
        responseSchema: z.object({
          values: z.array(z.any()).length(2),
        }),
      },
      {
        id: 'replace-parent-tags',
        method: 'PUT',
        path: '/categories/{{parentCategoryId}}/tag-groups',
        service: 'pim',
        body: {
          links: [
            {
              tagGroupId: '{{materialGroupId}}',
            },
          ],
        },
        expectedStatus: 204,
        description: '부모 태그 그룹 교체 (Material만)',
      },
      {
        id: 'verify-child-no-inheritance',
        method: 'GET',
        path: '/categories/{{childCategoryId}}/tag-groups',
        service: 'pim',
        expectedStatus: 200,
        description: '자식 카테고리에서 상속 제거 확인',
        responseSchema: z.object({
          tagGroups: z.array(z.any()),
        }),
      },
    ],
  },

  {
    id: 'TAG-014',
    name: 'displayOrder 정렬 및 isActive 필터 종합 테스트',
    category: 'PIM > Tags',
    validation: 'displayOrder, isActive 동작 확인',
    steps: [
      {
        id: 'create-group-a',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Group A {{timestamp}}',
          displayOrder: 20,
        },
        expectedStatus: 201,
        description: '그룹 A 생성 (order=20)',
        extractFromResponse: { groupAId: 'id' },
      },
      {
        id: 'create-group-b',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Group B {{timestamp}}',
          displayOrder: 10,
        },
        expectedStatus: 201,
        description: '그룹 B 생성 (order=10)',
        extractFromResponse: { groupBId: 'id' },
      },
      {
        id: 'create-group-c',
        method: 'POST',
        path: '/tags/groups',
        service: 'pim',
        body: {
          name: 'Group C {{timestamp}}',
          displayOrder: 30,
          isActive: false,
        },
        expectedStatus: 201,
        description: '그룹 C 생성 (order=30, inactive)',
      },
      {
        id: 'list-active-groups-ordered',
        method: 'GET',
        path: '/tags/groups',
        service: 'pim',
        queryParams: {
          isActive: 'true',
        },
        expectedStatus: 200,
        description: 'Active 그룹 정렬 확인 (B, A 순)',
        responseSchema: z.array(z.any()),
      },
      {
        id: 'update-group-b-order',
        method: 'PUT',
        path: '/tags/groups/{{groupBId}}',
        service: 'pim',
        body: {
          displayOrder: 25,
        },
        expectedStatus: 200,
        description: '그룹 B order를 25로 변경',
      },
      {
        id: 'list-reordered-groups',
        method: 'GET',
        path: '/tags/groups',
        service: 'pim',
        queryParams: {
          isActive: 'true',
        },
        expectedStatus: 200,
        description: '재정렬 확인 (A, B 순)',
        responseSchema: z.array(z.any()),
      },
      {
        id: 'add-value-v1',
        method: 'POST',
        path: '/tags/groups/{{groupAId}}/values',
        service: 'pim',
        body: {
          name: 'V1',
          displayOrder: 5,
        },
        expectedStatus: 201,
        description: 'Group A에 V1 추가 (order=5)',
        extractFromResponse: { v1Id: 'id' },
      },
      {
        id: 'add-value-v2',
        method: 'POST',
        path: '/tags/groups/{{groupAId}}/values',
        service: 'pim',
        body: {
          name: 'V2',
          displayOrder: 1,
        },
        expectedStatus: 201,
        description: 'Group A에 V2 추가 (order=1)',
        extractFromResponse: { v2Id: 'id' },
      },
      {
        id: 'add-value-v3',
        method: 'POST',
        path: '/tags/groups/{{groupAId}}/values',
        service: 'pim',
        body: {
          name: 'V3',
          displayOrder: 3,
        },
        expectedStatus: 201,
        description: 'Group A에 V3 추가 (order=3)',
      },
      {
        id: 'verify-value-order',
        method: 'GET',
        path: '/tags/groups/{{groupAId}}/detail',
        service: 'pim',
        expectedStatus: 200,
        description: '값 정렬 확인 (V2, V3, V1 순)',
        responseSchema: z.object({
          values: z.array(z.any()).length(3),
        }),
      },
      {
        id: 'update-v2-order',
        method: 'PUT',
        path: '/tags/values/{{v2Id}}',
        service: 'pim',
        body: {
          displayOrder: 10,
        },
        expectedStatus: 200,
        description: 'V2 order를 10으로 변경',
      },
      {
        id: 'verify-reordered-values',
        method: 'GET',
        path: '/tags/groups/{{groupAId}}/detail',
        service: 'pim',
        expectedStatus: 200,
        description: '재정렬 확인 (V3, V1, V2 순)',
        responseSchema: z.object({
          values: z.array(z.any()).length(3),
        }),
      },
    ],
  },
];
