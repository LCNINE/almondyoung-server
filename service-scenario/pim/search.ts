import { z } from 'zod';
import type { Scenario } from '../types';

export const searchScenarios: Scenario[] = [
  {
    id: 'SEARCH-001',
    name: '기본 키워드 검색',
    category: 'PIM > Product Search',
    validation: 'Elasticsearch를 통한 키워드 검색 기능 확인',
    steps: [
      {
        id: 'create-product-1',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 1 생성',
        extractFromResponse: {
          master1Id: 'masterId',
          version1Id: 'id',
        },
      },
      {
        id: 'update-product-1',
        method: 'PUT',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}',
        body: {
          name: '나이키 에어맥스 운동화',
          description: '편안한 러닝화',
          productCode: 'NIKE-001',
          brand: 'Nike',
        },
        expectedStatus: 200,
        description: '상품 1 정보 입력',
      },
      {
        id: 'publish-product-1',
        method: 'PATCH',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '상품 1 발행',
      },
      {
        id: 'create-product-2',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 마스터 2 생성',
        extractFromResponse: {
          master2Id: 'masterId',
          version2Id: 'id',
        },
      },
      {
        id: 'update-product-2',
        method: 'PUT',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}',
        body: {
          name: '아디다스 슈퍼스타',
          description: '클래식 스니커즈',
          productCode: 'ADIDAS-001',
          brand: 'Adidas',
        },
        expectedStatus: 200,
        description: '상품 2 정보 입력',
      },
      {
        id: 'publish-product-2',
        method: 'PATCH',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: '상품 2 발행',
      },
      {
        id: 'search-nike',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          keyword: '나이키',
        },
        expectedStatus: 200,
        description: '키워드 "나이키"로 검색',
        responseSchema: z.object({
          items: z
            .array(
              z.object({
                master_id: z.string(),
                product_id: z.string(),
                name: z.string(),
                status: z.string(),
              })
            )
            .min(1),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      },
      {
        id: 'search-운동화',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          keyword: '운동화',
        },
        expectedStatus: 200,
        description: '키워드 "운동화"로 검색',
        responseSchema: z.object({
          items: z.array(z.any()).min(1),
          pagination: z.object({
            total: z.number().min(1),
          }),
        }),
      },
    ],
  },

  {
    id: 'SEARCH-002',
    name: '카테고리 필터링',
    category: 'PIM > Product Search',
    validation: 'categoryId 파라미터로 특정 카테고리 상품만 검색',
    steps: [
      {
        id: 'create-category-shoes',
        method: 'POST',
        path: '/categories',
        body: {
          name: '신발',
          slug: 'shoes-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '신발 카테고리 생성',
        extractFromResponse: {
          shoesCategory: 'id',
        },
      },
      {
        id: 'create-category-clothes',
        method: 'POST',
        path: '/categories',
        body: {
          name: '의류',
          slug: 'clothes-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '의류 카테고리 생성',
        extractFromResponse: {
          clothesCategory: 'id',
        },
      },
      {
        id: 'create-shoes-product',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '신발 상품 생성',
        extractFromResponse: {
          shoesMasterId: 'masterId',
          shoesVersionId: 'id',
        },
      },
      {
        id: 'update-shoes-product',
        method: 'PUT',
        path: '/masters/{{shoesMasterId}}/versions/{{shoesVersionId}}',
        body: {
          name: '러닝화',
          categoryIds: ['{{shoesCategory}}'],
          primaryCategoryId: '{{shoesCategory}}',
        },
        expectedStatus: 200,
        description: '신발 상품 카테고리 설정',
      },
      {
        id: 'publish-shoes-product',
        method: 'PATCH',
        path: '/masters/{{shoesMasterId}}/versions/{{shoesVersionId}}/publish',
        expectedStatus: 200,
        description: '신발 상품 발행',
      },
      {
        id: 'create-clothes-product',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '의류 상품 생성',
        extractFromResponse: {
          clothesMasterId: 'masterId',
          clothesVersionId: 'id',
        },
      },
      {
        id: 'update-clothes-product',
        method: 'PUT',
        path: '/masters/{{clothesMasterId}}/versions/{{clothesVersionId}}',
        body: {
          name: '티셔츠',
          categoryIds: ['{{clothesCategory}}'],
          primaryCategoryId: '{{clothesCategory}}',
        },
        expectedStatus: 200,
        description: '의류 상품 카테고리 설정',
      },
      {
        id: 'publish-clothes-product',
        method: 'PATCH',
        path: '/masters/{{clothesMasterId}}/versions/{{clothesVersionId}}/publish',
        expectedStatus: 200,
        description: '의류 상품 발행',
      },
      {
        id: 'search-shoes-category',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          categoryId: '{{shoesCategory}}',
        },
        expectedStatus: 200,
        description: '신발 카테고리로 검색',
        responseSchema: z.object({
          items: z
            .array(
              z.object({
                master_id: z.string(),
                name: z.string(),
                category_id: z.string(),
              })
            )
            .min(1),
          pagination: z.object({
            total: z.number().min(1),
          }),
        }),
      },
    ],
  },

  {
    id: 'SEARCH-003',
    name: '브랜드 필터링',
    category: 'PIM > Product Search',
    validation: 'brands 파라미터로 여러 브랜드 OR 검색',
    steps: [
      {
        id: 'create-nike-product',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Nike 상품 생성',
        extractFromResponse: {
          nikeMasterId: 'masterId',
          nikeVersionId: 'id',
        },
      },
      {
        id: 'update-nike-product',
        method: 'PUT',
        path: '/masters/{{nikeMasterId}}/versions/{{nikeVersionId}}',
        body: {
          name: 'Nike Air Force',
          brand: 'Nike',
        },
        expectedStatus: 200,
        description: 'Nike 상품 정보 입력',
      },
      {
        id: 'publish-nike-product',
        method: 'PATCH',
        path: '/masters/{{nikeMasterId}}/versions/{{nikeVersionId}}/publish',
        expectedStatus: 200,
        description: 'Nike 상품 발행',
      },
      {
        id: 'create-adidas-product',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Adidas 상품 생성',
        extractFromResponse: {
          adidasMasterId: 'masterId',
          adidasVersionId: 'id',
        },
      },
      {
        id: 'update-adidas-product',
        method: 'PUT',
        path: '/masters/{{adidasMasterId}}/versions/{{adidasVersionId}}',
        body: {
          name: 'Adidas Ultraboost',
          brand: 'Adidas',
        },
        expectedStatus: 200,
        description: 'Adidas 상품 정보 입력',
      },
      {
        id: 'publish-adidas-product',
        method: 'PATCH',
        path: '/masters/{{adidasMasterId}}/versions/{{adidasVersionId}}/publish',
        expectedStatus: 200,
        description: 'Adidas 상품 발행',
      },
      {
        id: 'create-puma-product',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Puma 상품 생성',
        extractFromResponse: {
          pumaMasterId: 'masterId',
          pumaVersionId: 'id',
        },
      },
      {
        id: 'update-puma-product',
        method: 'PUT',
        path: '/masters/{{pumaMasterId}}/versions/{{pumaVersionId}}',
        body: {
          name: 'Puma Suede',
          brand: 'Puma',
        },
        expectedStatus: 200,
        description: 'Puma 상품 정보 입력',
      },
      {
        id: 'publish-puma-product',
        method: 'PATCH',
        path: '/masters/{{pumaMasterId}}/versions/{{pumaVersionId}}/publish',
        expectedStatus: 200,
        description: 'Puma 상품 발행',
      },
      {
        id: 'search-single-brand',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          brands: 'Nike',
        },
        expectedStatus: 200,
        description: '단일 브랜드 검색',
        responseSchema: z.object({
          items: z
            .array(
              z.object({
                brand: z.literal('Nike'),
              })
            )
            .min(1),
        }),
      },
      {
        id: 'search-multiple-brands',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          brands: JSON.stringify(['Nike', 'Adidas']),
        },
        expectedStatus: 200,
        description: '여러 브랜드 OR 검색',
        responseSchema: z.object({
          items: z.array(z.any()).min(2),
          pagination: z.object({
            total: z.number().min(2),
          }),
        }),
      },
    ],
  },

  {
    id: 'SEARCH-004',
    name: '가격 범위 필터링 (Placeholder)',
    category: 'PIM > Product Search',
    validation:
      'Price range filtering with minPrice and maxPrice - SKIPPED: Price field not indexed in current ES setup. To implement this scenario, product prices must be set via pricing rules (PUT /products/:masterId/pricing/rules) before publish, which is outside the scope of current test scenarios.',
    steps: [],
  },

  {
    id: 'SEARCH-005',
    name: '복합 태그 필터링',
    category: 'PIM > Product Search',
    validation: '태그 그룹 간 AND, 태그 값 간 OR 로직을 사용한 복합 필터링',
    steps: [
      {
        id: 'create-color-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: '색상',
          code: 'color-{{timestamp}}',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: '색상 태그 그룹 생성',
        extractFromResponse: {
          colorGroupId: 'id',
        },
      },
      {
        id: 'create-red-tag',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        body: {
          name: '빨강',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: '빨강 태그 생성',
        extractFromResponse: {
          redTagId: 'id',
        },
      },
      {
        id: 'create-blue-tag',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        body: {
          name: '파랑',
          displayOrder: 2,
          isActive: true,
        },
        expectedStatus: 201,
        description: '파랑 태그 생성',
        extractFromResponse: {
          blueTagId: 'id',
        },
      },
      {
        id: 'create-size-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: '사이즈',
          code: 'size-{{timestamp}}',
          displayOrder: 2,
          isActive: true,
        },
        expectedStatus: 201,
        description: '사이즈 태그 그룹 생성',
        extractFromResponse: {
          sizeGroupId: 'id',
        },
      },
      {
        id: 'create-small-tag',
        method: 'POST',
        path: '/tags/groups/{{sizeGroupId}}/values',
        body: {
          name: 'Small',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: 'Small 태그 생성',
        extractFromResponse: {
          smallTagId: 'id',
        },
      },
      {
        id: 'create-large-tag',
        method: 'POST',
        path: '/tags/groups/{{sizeGroupId}}/values',
        body: {
          name: 'Large',
          displayOrder: 2,
          isActive: true,
        },
        expectedStatus: 201,
        description: 'Large 태그 생성',
        extractFromResponse: {
          largeTagId: 'id',
        },
      },
      {
        id: 'create-product-red-small',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '빨강/Small 상품 생성',
        extractFromResponse: {
          redSmallMasterId: 'masterId',
          redSmallVersionId: 'id',
        },
      },
      {
        id: 'update-product-red-small',
        method: 'PUT',
        path: '/masters/{{redSmallMasterId}}/versions/{{redSmallVersionId}}',
        body: {
          name: '빨강 Small 상품',
          tagValueIds: ['{{redTagId}}', '{{smallTagId}}'],
        },
        expectedStatus: 200,
        description: '빨강/Small 태그 연결',
      },
      {
        id: 'publish-product-red-small',
        method: 'PATCH',
        path: '/masters/{{redSmallMasterId}}/versions/{{redSmallVersionId}}/publish',
        expectedStatus: 200,
        description: '빨강/Small 상품 발행',
      },
      {
        id: 'create-product-blue-large',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '파랑/Large 상품 생성',
        extractFromResponse: {
          blueLargeMasterId: 'masterId',
          blueLargeVersionId: 'id',
        },
      },
      {
        id: 'update-product-blue-large',
        method: 'PUT',
        path: '/masters/{{blueLargeMasterId}}/versions/{{blueLargeVersionId}}',
        body: {
          name: '파랑 Large 상품',
          tagValueIds: ['{{blueTagId}}', '{{largeTagId}}'],
        },
        expectedStatus: 200,
        description: '파랑/Large 태그 연결',
      },
      {
        id: 'publish-product-blue-large',
        method: 'PATCH',
        path: '/masters/{{blueLargeMasterId}}/versions/{{blueLargeVersionId}}/publish',
        expectedStatus: 200,
        description: '파랑/Large 상품 발행',
      },
      {
        id: 'create-product-red-large',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '빨강/Large 상품 생성',
        extractFromResponse: {
          redLargeMasterId: 'masterId',
          redLargeVersionId: 'id',
        },
      },
      {
        id: 'update-product-red-large',
        method: 'PUT',
        path: '/masters/{{redLargeMasterId}}/versions/{{redLargeVersionId}}',
        body: {
          name: '빨강 Large 상품',
          tagValueIds: ['{{redTagId}}', '{{largeTagId}}'],
        },
        expectedStatus: 200,
        description: '빨강/Large 태그 연결',
      },
      {
        id: 'publish-product-red-large',
        method: 'PATCH',
        path: '/masters/{{redLargeMasterId}}/versions/{{redLargeVersionId}}/publish',
        expectedStatus: 200,
        description: '빨강/Large 상품 발행',
      },
      {
        id: 'search-single-tag-group',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          tagFilters: JSON.stringify([
            {
              groupId: '{{colorGroupId}}',
              valueIds: ['{{redTagId}}'],
            },
          ]),
        },
        expectedStatus: 200,
        description: '단일 태그 그룹 필터링 (색상: 빨강)',
        responseSchema: z.object({
          items: z.array(z.any()).min(2), // 빨강/Small, 빨강/Large
        }),
      },
      {
        id: 'search-multiple-values-or',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          tagFilters: JSON.stringify([
            {
              groupId: '{{colorGroupId}}',
              valueIds: ['{{redTagId}}', '{{blueTagId}}'],
            },
          ]),
        },
        expectedStatus: 200,
        description: '같은 그룹 내 여러 값 OR 검색 (색상: 빨강 OR 파랑)',
        responseSchema: z.object({
          items: z.array(z.any()).min(3), // 모든 상품
        }),
      },
      {
        id: 'search-multiple-groups-and',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          tagFilters: JSON.stringify([
            {
              groupId: '{{colorGroupId}}',
              valueIds: ['{{redTagId}}'],
            },
            {
              groupId: '{{sizeGroupId}}',
              valueIds: ['{{largeTagId}}'],
            },
          ]),
        },
        expectedStatus: 200,
        description: '여러 그룹 AND 검색 (색상: 빨강 AND 사이즈: Large)',
        responseSchema: z.object({
          items: z.array(z.any()).length(1), // 빨강/Large만
        }),
      },
    ],
  },

  {
    id: 'SEARCH-006',
    name: '정렬 및 페이지네이션',
    category: 'PIM > Product Search',
    validation: 'sortBy, sortOrder, page, limit 파라미터 검증',
    steps: [
      {
        id: 'create-product-1',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 1 생성',
        extractFromResponse: {
          master1Id: 'masterId',
          version1Id: 'id',
        },
      },
      {
        id: 'update-product-1',
        method: 'PUT',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}',
        body: {
          name: 'Product A',
        },
        expectedStatus: 200,
        description: '상품 1 정보 입력',
      },
      {
        id: 'publish-product-1',
        method: 'PATCH',
        path: '/masters/{{master1Id}}/versions/{{version1Id}}/publish',
        expectedStatus: 200,
        description: '상품 1 발행',
      },
      {
        id: 'create-product-2',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 2 생성',
        extractFromResponse: {
          master2Id: 'masterId',
          version2Id: 'id',
        },
      },
      {
        id: 'update-product-2',
        method: 'PUT',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}',
        body: {
          name: 'Product B',
        },
        expectedStatus: 200,
        description: '상품 2 정보 입력',
      },
      {
        id: 'publish-product-2',
        method: 'PATCH',
        path: '/masters/{{master2Id}}/versions/{{version2Id}}/publish',
        expectedStatus: 200,
        description: '상품 2 발행',
      },
      {
        id: 'create-product-3',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: '상품 3 생성',
        extractFromResponse: {
          master3Id: 'masterId',
          version3Id: 'id',
        },
      },
      {
        id: 'update-product-3',
        method: 'PUT',
        path: '/masters/{{master3Id}}/versions/{{version3Id}}',
        body: {
          name: 'Product C',
        },
        expectedStatus: 200,
        description: '상품 3 정보 입력',
      },
      {
        id: 'publish-product-3',
        method: 'PATCH',
        path: '/masters/{{master3Id}}/versions/{{version3Id}}/publish',
        expectedStatus: 200,
        description: '상품 3 발행',
      },
      {
        id: 'search-sort-created-desc',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
        expectedStatus: 200,
        description: '생성일 내림차순 정렬',
        responseSchema: z.object({
          items: z.array(z.any()).min(3),
        }),
      },
      {
        id: 'search-sort-created-asc',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          sortBy: 'createdAt',
          sortOrder: 'asc',
        },
        expectedStatus: 200,
        description: '생성일 오름차순 정렬',
        responseSchema: z.object({
          items: z.array(z.any()).min(3),
        }),
      },
      {
        id: 'search-page-1-limit-2',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          page: '1',
          limit: '2',
        },
        expectedStatus: 200,
        description: '첫 페이지 (limit=2)',
        responseSchema: z.object({
          items: z.array(z.any()).max(2),
          pagination: z.object({
            page: z.literal(1),
            limit: z.literal(2),
            total: z.number().min(3),
            totalPages: z.number().min(2),
          }),
        }),
      },
      {
        id: 'search-page-2-limit-2',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          page: '2',
          limit: '2',
        },
        expectedStatus: 200,
        description: '두 번째 페이지 (limit=2)',
        responseSchema: z.object({
          items: z.array(z.any()).min(1),
          pagination: z.object({
            page: z.literal(2),
            limit: z.literal(2),
          }),
        }),
      },
    ],
  },

  {
    id: 'SEARCH-007',
    name: 'Aggregations (태그 집계)',
    category: 'PIM > Product Search',
    validation: '응답에 포함되는 태그별 상품 개수 집계 확인',
    steps: [
      {
        id: 'create-tag-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: '브랜드',
          code: 'brand-{{timestamp}}',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: '브랜드 태그 그룹 생성',
        extractFromResponse: {
          brandGroupId: 'id',
        },
      },
      {
        id: 'create-nike-tag',
        method: 'POST',
        path: '/tags/groups/{{brandGroupId}}/values',
        body: {
          name: 'Nike',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: 'Nike 태그 생성',
        extractFromResponse: {
          nikeTagId: 'id',
        },
      },
      {
        id: 'create-adidas-tag',
        method: 'POST',
        path: '/tags/groups/{{brandGroupId}}/values',
        body: {
          name: 'Adidas',
          displayOrder: 2,
          isActive: true,
        },
        expectedStatus: 201,
        description: 'Adidas 태그 생성',
        extractFromResponse: {
          adidasTagId: 'id',
        },
      },
      {
        id: 'create-nike-product-1',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Nike 상품 1 생성',
        extractFromResponse: {
          nike1MasterId: 'masterId',
          nike1VersionId: 'id',
        },
      },
      {
        id: 'update-nike-product-1',
        method: 'PUT',
        path: '/masters/{{nike1MasterId}}/versions/{{nike1VersionId}}',
        body: {
          name: 'Nike Product 1',
          tagValueIds: ['{{nikeTagId}}'],
        },
        expectedStatus: 200,
        description: 'Nike 태그 연결',
      },
      {
        id: 'publish-nike-product-1',
        method: 'PATCH',
        path: '/masters/{{nike1MasterId}}/versions/{{nike1VersionId}}/publish',
        expectedStatus: 200,
        description: 'Nike 상품 1 발행',
      },
      {
        id: 'create-nike-product-2',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Nike 상품 2 생성',
        extractFromResponse: {
          nike2MasterId: 'masterId',
          nike2VersionId: 'id',
        },
      },
      {
        id: 'update-nike-product-2',
        method: 'PUT',
        path: '/masters/{{nike2MasterId}}/versions/{{nike2VersionId}}',
        body: {
          name: 'Nike Product 2',
          tagValueIds: ['{{nikeTagId}}'],
        },
        expectedStatus: 200,
        description: 'Nike 태그 연결',
      },
      {
        id: 'publish-nike-product-2',
        method: 'PATCH',
        path: '/masters/{{nike2MasterId}}/versions/{{nike2VersionId}}/publish',
        expectedStatus: 200,
        description: 'Nike 상품 2 발행',
      },
      {
        id: 'create-adidas-product',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Adidas 상품 생성',
        extractFromResponse: {
          adidasMasterId: 'masterId',
          adidasVersionId: 'id',
        },
      },
      {
        id: 'update-adidas-product',
        method: 'PUT',
        path: '/masters/{{adidasMasterId}}/versions/{{adidasVersionId}}',
        body: {
          name: 'Adidas Product',
          tagValueIds: ['{{adidasTagId}}'],
        },
        expectedStatus: 200,
        description: 'Adidas 태그 연결',
      },
      {
        id: 'publish-adidas-product',
        method: 'PATCH',
        path: '/masters/{{adidasMasterId}}/versions/{{adidasVersionId}}/publish',
        expectedStatus: 200,
        description: 'Adidas 상품 발행',
      },
      {
        id: 'search-with-aggregations',
        method: 'GET',
        path: '/products/search',
        expectedStatus: 200,
        description: 'Aggregations 포함 검색',
        responseSchema: z.object({
          items: z.array(z.any()).min(3),
          pagination: z.object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
          aggregations: z
            .object({
              tags: z.array(
                z.object({
                  group_id: z.string(),
                  group_name: z.string(),
                  values: z.array(
                    z.object({
                      value_id: z.string(),
                      value_name: z.string(),
                      count: z.number(),
                    })
                  ),
                })
              ),
            })
            .optional(),
        }),
      },
    ],
  },

  {
    id: 'SEARCH-008',
    name: '복합 필터 조합',
    category: 'PIM > Product Search',
    validation: '키워드, 카테고리, 브랜드, 태그, 정렬을 모두 조합한 검색',
    steps: [
      {
        id: 'create-category',
        method: 'POST',
        path: '/categories',
        body: {
          name: '운동화',
          slug: 'sneakers-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '운동화 카테고리 생성',
        extractFromResponse: {
          categoryId: 'id',
        },
      },
      {
        id: 'create-color-group',
        method: 'POST',
        path: '/tags/groups',
        body: {
          name: '색상',
          code: 'color-{{timestamp}}',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: '색상 태그 그룹 생성',
        extractFromResponse: {
          colorGroupId: 'id',
        },
      },
      {
        id: 'create-black-tag',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        body: {
          name: '검정',
          displayOrder: 1,
          isActive: true,
        },
        expectedStatus: 201,
        description: '검정 태그 생성',
        extractFromResponse: {
          blackTagId: 'id',
        },
      },
      {
        id: 'create-white-tag',
        method: 'POST',
        path: '/tags/groups/{{colorGroupId}}/values',
        body: {
          name: '흰색',
          displayOrder: 2,
          isActive: true,
        },
        expectedStatus: 201,
        description: '흰색 태그 생성',
        extractFromResponse: {
          whiteTagId: 'id',
        },
      },
      {
        id: 'create-nike-black',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Nike 검정 운동화 생성',
        extractFromResponse: {
          nikeBlackMasterId: 'masterId',
          nikeBlackVersionId: 'id',
        },
      },
      {
        id: 'update-nike-black',
        method: 'PUT',
        path: '/masters/{{nikeBlackMasterId}}/versions/{{nikeBlackVersionId}}',
        body: {
          name: 'Nike Air Max Black',
          brand: 'Nike',
          categoryIds: ['{{categoryId}}'],
          primaryCategoryId: '{{categoryId}}',
          tagValueIds: ['{{blackTagId}}'],
        },
        expectedStatus: 200,
        description: 'Nike 검정 운동화 정보 입력',
      },
      {
        id: 'publish-nike-black',
        method: 'PATCH',
        path: '/masters/{{nikeBlackMasterId}}/versions/{{nikeBlackVersionId}}/publish',
        expectedStatus: 200,
        description: 'Nike 검정 운동화 발행',
      },
      {
        id: 'create-nike-white',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Nike 흰색 운동화 생성',
        extractFromResponse: {
          nikeWhiteMasterId: 'masterId',
          nikeWhiteVersionId: 'id',
        },
      },
      {
        id: 'update-nike-white',
        method: 'PUT',
        path: '/masters/{{nikeWhiteMasterId}}/versions/{{nikeWhiteVersionId}}',
        body: {
          name: 'Nike Air Force White',
          brand: 'Nike',
          categoryIds: ['{{categoryId}}'],
          primaryCategoryId: '{{categoryId}}',
          tagValueIds: ['{{whiteTagId}}'],
        },
        expectedStatus: 200,
        description: 'Nike 흰색 운동화 정보 입력',
      },
      {
        id: 'publish-nike-white',
        method: 'PATCH',
        path: '/masters/{{nikeWhiteMasterId}}/versions/{{nikeWhiteVersionId}}/publish',
        expectedStatus: 200,
        description: 'Nike 흰색 운동화 발행',
      },
      {
        id: 'create-adidas-black',
        method: 'POST',
        path: '/masters',
        body: {},
        expectedStatus: 201,
        description: 'Adidas 검정 운동화 생성',
        extractFromResponse: {
          adidasBlackMasterId: 'masterId',
          adidasBlackVersionId: 'id',
        },
      },
      {
        id: 'update-adidas-black',
        method: 'PUT',
        path: '/masters/{{adidasBlackMasterId}}/versions/{{adidasBlackVersionId}}',
        body: {
          name: 'Adidas Ultraboost Black',
          brand: 'Adidas',
          categoryIds: ['{{categoryId}}'],
          primaryCategoryId: '{{categoryId}}',
          tagValueIds: ['{{blackTagId}}'],
        },
        expectedStatus: 200,
        description: 'Adidas 검정 운동화 정보 입력',
      },
      {
        id: 'publish-adidas-black',
        method: 'PATCH',
        path: '/masters/{{adidasBlackMasterId}}/versions/{{adidasBlackVersionId}}/publish',
        expectedStatus: 200,
        description: 'Adidas 검정 운동화 발행',
      },
      {
        id: 'search-combined-filters',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          keyword: 'Nike',
          categoryId: '{{categoryId}}',
          brands: 'Nike',
          tagFilters: JSON.stringify([
            {
              groupId: '{{colorGroupId}}',
              valueIds: ['{{blackTagId}}', '{{whiteTagId}}'],
            },
          ]),
          sortBy: 'createdAt',
          sortOrder: 'desc',
          page: '1',
          limit: '10',
        },
        expectedStatus: 200,
        description: '모든 필터 조합 검색',
        responseSchema: z.object({
          items: z
            .array(
              z.object({
                master_id: z.string(),
                product_id: z.string(),
                name: z.string(),
                brand: z.string(),
                category_id: z.string(),
                status: z.string(),
              })
            )
            .min(1),
          pagination: z.object({
            page: z.literal(1),
            limit: z.literal(10),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      },
      {
        id: 'search-narrow-filter',
        method: 'GET',
        path: '/products/search',
        queryParams: {
          categoryId: '{{categoryId}}',
          brands: 'Nike',
          tagFilters: JSON.stringify([
            {
              groupId: '{{colorGroupId}}',
              valueIds: ['{{blackTagId}}'],
            },
          ]),
        },
        expectedStatus: 200,
        description: '좁은 범위 필터 (Nike + 검정)',
        responseSchema: z.object({
          items: z.array(z.any()).length(1), // Nike Air Max Black만
          pagination: z.object({
            total: z.literal(1),
          }),
        }),
      },
    ],
  },
];
