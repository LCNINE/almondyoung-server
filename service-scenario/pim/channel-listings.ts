import { z } from 'zod';
import type { Scenario } from '../types';

/**
 * Channel Listings (Channel Variant Mappings) API Test Scenarios
 *
 * Coverage: 8 endpoints
 * - GET /channel-listings/lookup (채널 상품 ID로 Variant 조회)
 * - POST /channel-listings (채널 매핑 생성)
 * - GET /channel-listings/by-variant/:variantId (Variant의 채널 등록 현황 조회)
 * - GET /channel-listings/:id (채널 매핑 상세 조회)
 * - PUT /channel-listings/:id (채널 매핑 수정)
 * - PUT /channel-listings/:id/deactivate (채널 매핑 비활성화)
 * - PUT /channel-listings/:id/activate (채널 매핑 활성화)
 * - DELETE /channel-listings/:id (채널 매핑 삭제)
 *
 * Total Scenarios: 10
 */

export const channelListingScenarios: Scenario[] = [
  // ========================================
  // Group 1: Basic CRUD Operations (CHLST-001 ~ CHLST-002)
  // ========================================
  {
    id: 'CHLST-001',
    name: '채널 매핑 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Channel Listings',
    validation: '채널 매핑 전체 CRUD 플로우 확인',
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
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Coupang Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'COUPANG-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '채널 매핑 생성',
        extractFromResponse: { listingId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          variantId: z.string().uuid(),
          salesChannelId: z.string().uuid(),
          channelItemId: z.string(),
          isActive: z.boolean(),
        }),
      },
      {
        id: 'get-listing',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '생성된 채널 매핑 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          variantId: z.string().uuid(),
          salesChannelId: z.string().uuid(),
          channelItemId: z.string(),
        }),
      },
      {
        id: 'update-listing',
        method: 'PUT',
        path: '/channel-listings/{{listingId}}',
        body: {
          channelItemName: '쿠팡 상품명',
          channelPrice: 29000,
        },
        expectedStatus: 200,
        description: '채널 매핑 수정',
        responseSchema: z.object({
          id: z.string().uuid(),
        }),
      },
      {
        id: 'get-updated-listing',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '수정된 매핑 조회',
      },
      {
        id: 'delete-listing',
        method: 'DELETE',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '채널 매핑 삭제',
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 404,
        description: '삭제된 매핑 조회 (404 기대)',
      },
    ],
  },

  {
    id: 'CHLST-002',
    name: '채널 매핑 활성화/비활성화',
    category: 'PIM > Channel Listings',
    validation: '채널 매핑 상태 관리 확인',
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
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '채널 매핑 생성 (기본 활성)',
        extractFromResponse: { listingId: 'id' },
      },
      {
        id: 'deactivate-listing',
        method: 'PUT',
        path: '/channel-listings/{{listingId}}/deactivate',
        expectedStatus: 200,
        description: '채널 매핑 비활성화',
      },
      {
        id: 'verify-inactive',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '비활성 상태 확인',
        responseSchema: z.object({
          id: z.string().uuid(),
          isActive: z.literal(false),
        }),
      },
      {
        id: 'activate-listing',
        method: 'PUT',
        path: '/channel-listings/{{listingId}}/activate',
        expectedStatus: 200,
        description: '채널 매핑 활성화',
      },
      {
        id: 'verify-active',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '활성 상태 확인',
        responseSchema: z.object({
          id: z.string().uuid(),
          isActive: z.literal(true),
        }),
      },
    ],
  },

  // ========================================
  // Group 2: Lookup and Query Operations (CHLST-003 ~ CHLST-005)
  // ========================================
  {
    id: 'CHLST-003',
    name: '채널 상품 ID로 Variant 조회 (salesChannelId)',
    category: 'PIM > Channel Listings',
    validation: 'salesChannelId + channelItemId로 Variant 룩업 확인',
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
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '채널 매핑 생성',
        extractFromResponse: { channelItemId: 'channelItemId' },
      },
      {
        id: 'lookup-variant',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '{{salesChannelId}}',
          channelItemId: '{{channelItemId}}',
        },
        expectedStatus: 200,
        description: 'Variant 룩업 성공',
        responseSchema: z.object({
          variantId: z.string().uuid(),
          isActive: z.boolean(),
        }),
      },
      {
        id: 'lookup-not-found',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'NON-EXISTENT',
        },
        expectedStatus: 204,
        description: '존재하지 않는 채널 상품 ID (204 기대)',
      },
    ],
  },

  {
    id: 'CHLST-004',
    name: '채널 상품 ID로 Variant 조회 (channelCode)',
    category: 'PIM > Channel Listings',
    validation: 'channelCode + channelItemId로 Variant 룩업 확인',
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
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Naver Channel {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '네이버 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'NAVER-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '채널 매핑 생성',
        extractFromResponse: { channelItemId: 'channelItemId' },
      },
      {
        id: 'lookup-by-code',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          channelCode: 'naver',
          channelItemId: '{{channelItemId}}',
        },
        expectedStatus: 200,
        description: 'channelCode로 Variant 룩업',
        responseSchema: z.object({
          variantId: z.string().uuid(),
        }),
      },
      {
        id: 'lookup-wrong-code',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          channelCode: 'coupang',
          channelItemId: '{{channelItemId}}',
        },
        expectedStatus: 204,
        description: '잘못된 채널 코드로 조회 (204 기대)',
      },
    ],
  },

  {
    id: 'CHLST-005',
    name: 'Variant의 채널 등록 현황 조회',
    category: 'PIM > Channel Listings',
    validation: '하나의 Variant가 여러 채널에 등록된 현황 조회',
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
        id: 'create-channel-1',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Coupang {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '쿠팡 채널 생성',
        extractFromResponse: { channelId1: 'id' },
      },
      {
        id: 'create-channel-2',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Naver {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '네이버 채널 생성',
        extractFromResponse: { channelId2: 'id' },
      },
      {
        id: 'create-channel-3',
        method: 'POST',
        path: '/channels',
        body: {
          name: '11st {{timestamp}}',
          site: 'other',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '11st 채널 생성',
        extractFromResponse: { channelId3: 'id' },
      },
      {
        id: 'create-listing-1',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{channelId1}}',
          channelItemId: 'COUPANG-ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '쿠팡 매핑 생성',
      },
      {
        id: 'create-listing-2',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{channelId2}}',
          channelItemId: 'NAVER-ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '네이버 매핑 생성',
      },
      {
        id: 'create-listing-3',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{channelId3}}',
          channelItemId: '11ST-ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '11st 매핑 생성',
      },
      {
        id: 'get-by-variant',
        method: 'GET',
        path: '/channel-listings/by-variant/{{variantId}}',
        expectedStatus: 200,
        description: 'Variant의 모든 채널 매핑 조회',
        responseSchema: z.array(
          z.object({
            id: z.string().uuid(),
            channelItemId: z.string(),
            isActive: z.boolean(),
            channel: z.object({
              id: z.string().uuid(),
              name: z.string(),
              site: z.string(),
            }),
          }),
        ).min(3),
      },
    ],
  },

  // ========================================
  // Group 3: Complex Workflows (CHLST-006 ~ CHLST-007)
  // ========================================
  {
    id: 'CHLST-006',
    name: '다중 Variant 채널 매핑',
    category: 'PIM > Channel Listings',
    validation: '옵션이 있는 상품의 여러 Variant를 채널에 매핑',
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
          name: 'Product with Options {{timestamp}}',
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
        description: '옵션 추가 (색상: 빨강/파랑, 사이즈: S/M)',
      },
      {
        id: 'publish-version',
        method: 'PATCH',
        path: '/masters/{{masterId}}/versions/{{versionId}}/publish',
        expectedStatus: 200,
        description: '버전 Publish (4개 Variant 생성)',
      },
      {
        id: 'get-variants',
        method: 'GET',
        path: '/variants/masters/{{masterId}}',
        expectedStatus: 200,
        description: '생성된 Variant 조회 (4개)',
        extractFromResponse: {
          variantId1: 'data.0.id',
          variantId2: 'data.1.id',
          variantId3: 'data.2.id',
          variantId4: 'data.3.id',
        },
        responseSchema: z.object({
          data: z.array(z.any()).length(4),
        }),
      },
      {
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing-1',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId1}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-001-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Variant 1 매핑 생성',
        extractFromResponse: { channelItemId1: 'channelItemId' },
      },
      {
        id: 'create-listing-2',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId2}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-002-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Variant 2 매핑 생성',
        extractFromResponse: { channelItemId2: 'channelItemId' },
      },
      {
        id: 'create-listing-3',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId3}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-003-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Variant 3 매핑 생성',
        extractFromResponse: { channelItemId3: 'channelItemId' },
      },
      {
        id: 'create-listing-4',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId4}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-004-{{timestamp}}',
        },
        expectedStatus: 201,
        description: 'Variant 4 매핑 생성',
        extractFromResponse: { channelItemId4: 'channelItemId' },
      },
      {
        id: 'lookup-variant-1',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '{{salesChannelId}}',
          channelItemId: '{{channelItemId1}}',
        },
        expectedStatus: 200,
        description: 'Variant 1 룩업 확인',
      },
      {
        id: 'lookup-variant-2',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '{{salesChannelId}}',
          channelItemId: '{{channelItemId2}}',
        },
        expectedStatus: 200,
        description: 'Variant 2 룩업 확인',
      },
      {
        id: 'lookup-variant-3',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '{{salesChannelId}}',
          channelItemId: '{{channelItemId3}}',
        },
        expectedStatus: 200,
        description: 'Variant 3 룩업 확인',
      },
      {
        id: 'lookup-variant-4',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '{{salesChannelId}}',
          channelItemId: '{{channelItemId4}}',
        },
        expectedStatus: 200,
        description: 'Variant 4 룩업 확인',
      },
    ],
  },

  {
    id: 'CHLST-007',
    name: '채널 매핑 수정 - 가격 및 URL 업데이트',
    category: 'PIM > Channel Listings',
    validation: '채널 매핑의 부가 정보 업데이트 확인',
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
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '채널 매핑 생성 (옵션 필드 없음)',
        extractFromResponse: { listingId: 'id' },
      },
      {
        id: 'update-price',
        method: 'PUT',
        path: '/channel-listings/{{listingId}}',
        body: {
          channelPrice: 29000,
        },
        expectedStatus: 200,
        description: '가격 추가',
      },
      {
        id: 'verify-price',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '가격 설정 확인',
        responseSchema: z.object({
          id: z.string().uuid(),
          channelPrice: z.literal(29000),
        }),
      },
      {
        id: 'update-url',
        method: 'PUT',
        path: '/channel-listings/{{listingId}}',
        body: {
          channelProductUrl: 'https://example.com/product/123',
        },
        expectedStatus: 200,
        description: 'URL 추가',
      },
      {
        id: 'verify-url-and-price',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: 'URL 설정 확인 및 가격 유지 확인',
      },
      {
        id: 'update-names',
        method: 'PUT',
        path: '/channel-listings/{{listingId}}',
        body: {
          channelItemName: '쿠팡 상품명',
          channelOptionName: '빨강 / L',
        },
        expectedStatus: 200,
        description: '상품명 및 옵션명 추가',
      },
      {
        id: 'verify-all-fields',
        method: 'GET',
        path: '/channel-listings/{{listingId}}',
        expectedStatus: 200,
        description: '모든 필드 확인',
      },
    ],
  },

  // ========================================
  // Group 4: Edge Cases and Error Handling (CHLST-008 ~ CHLST-010)
  // ========================================
  {
    id: 'CHLST-008',
    name: '채널 매핑 중복 생성 방지',
    category: 'PIM > Channel Listings',
    validation: '동일 채널+상품ID 조합으로 중복 생성 불가 확인',
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
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-listing',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'DUPLICATE-ITEM-{{timestamp}}',
        },
        expectedStatus: 201,
        description: '채널 매핑 생성',
        extractFromResponse: { channelItemId: 'channelItemId' },
      },
      {
        id: 'create-duplicate',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: '{{channelItemId}}',
        },
        expectedStatus: 409,
        description: '중복 매핑 생성 시도 (409 기대)',
      },
    ],
  },

  {
    id: 'CHLST-009',
    name: 'Lookup 필수 파라미터 검증',
    category: 'PIM > Channel Listings',
    validation: 'Lookup API의 파라미터 검증 확인',
    steps: [
      {
        id: 'lookup-without-item-id',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          salesChannelId: '00000000-0000-0000-0000-000000000000',
        },
        expectedStatus: 400,
        description: 'channelItemId 없이 조회 (400 기대)',
      },
      {
        id: 'lookup-without-channel',
        method: 'GET',
        path: '/channel-listings/lookup',
        queryParams: {
          channelItemId: 'SOME-ITEM',
        },
        expectedStatus: 400,
        description: 'salesChannelId/channelCode 없이 조회 (400 기대)',
      },
    ],
  },

  {
    id: 'CHLST-010',
    name: '존재하지 않는 리소스로 생성 시도',
    category: 'PIM > Channel Listings',
    validation: '잘못된 참조로 생성 시 에러 처리 확인',
    steps: [
      {
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { salesChannelId: 'id' },
      },
      {
        id: 'create-with-fake-variant',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '00000000-0000-0000-0000-000000000000',
          salesChannelId: '{{salesChannelId}}',
          channelItemId: 'TEST-ITEM',
        },
        expectedStatus: 400,
        description: '존재하지 않는 variantId로 생성 시도',
      },
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
        id: 'create-with-fake-channel',
        method: 'POST',
        path: '/channel-listings',
        body: {
          variantId: '{{variantId}}',
          salesChannelId: '00000000-0000-0000-0000-000000000000',
          channelItemId: 'TEST-ITEM',
        },
        expectedStatus: 400,
        description: '존재하지 않는 salesChannelId로 생성 시도',
      },
    ],
  },
];
