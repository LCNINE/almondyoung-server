import { z } from 'zod';
import type { Scenario } from '../types';

/**
 * 판매 채널 (Sales Channels) 시나리오
 *
 * 테스트 범위:
 * - POST /channels (판매 채널 생성)
 * - GET /channels (판매 채널 목록 조회)
 * - GET /channels/active (활성 채널 조회)
 * - GET /channels/:id (판매 채널 상세 조회)
 * - PUT /channels/:id (판매 채널 수정)
 * - DELETE /channels/:id (판매 채널 삭제)
 * - PUT /channels/:id/status (채널 상태 설정)
 * - GET /channels/type/:type (타입별 채널 조회)
 * - POST /channels/validate (채널 설정 검증)
 */

export const salesChannelScenarios: Scenario[] = [
  // ========================================
  // Group 1: 기본 CRUD 테스트 (CHAN-001 ~ CHAN-004)
  // ========================================
  {
    id: 'CHAN-001',
    name: '판매 채널 생성 → 조회 → 수정 → 삭제',
    category: 'PIM > Sales Channels',
    validation: '판매 채널 전체 CRUD 플로우 확인',
    steps: [
      {
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Test Channel {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
          description: '테스트 채널',
          isActive: true,
        },
        expectedStatus: 201,
        description: '판매 채널 생성',
        extractFromResponse: { channelId: 'id' },
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
          site: z.enum(['medusa', 'naver', 'coupang', 'phone_order', 'other']),
          type: z.string(),
          isActive: z.boolean(),
          config: z.any(),
          credentials: z.any(),
        }),
      },
      {
        id: 'get-channel',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: '생성된 채널 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          site: z.literal('medusa'),
          isActive: z.literal(true),
        }),
      },
      {
        id: 'update-channel',
        method: 'PUT',
        path: '/channels/{{channelId}}',
        body: {
          name: 'Updated Channel {{timestamp}}',
          description: '수정된 설명',
        },
        expectedStatus: 200,
        description: '채널 정보 수정',
        responseSchema: z.object({
          id: z.string().uuid(),
          name: z.string(),
        }),
      },
      {
        id: 'delete-channel',
        method: 'DELETE',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: '채널 삭제',
      },
      {
        id: 'verify-deleted',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 404,
        description: '삭제된 채널 조회 (404 예상)',
      },
    ],
  },

  {
    id: 'CHAN-002',
    name: '채널 분류 연결 및 수정',
    category: 'PIM > Sales Channels',
    validation: '채널에 분류를 연결하고 변경할 수 있는지 확인',
    steps: [
      {
        id: 'create-category-1',
        method: 'POST',
        path: '/channels/categories',
        body: {
          name: 'Category 1 {{timestamp}}',
          displayOrder: 10,
        },
        expectedStatus: 201,
        description: '분류 1 생성',
        extractFromResponse: { category1Id: 'id' },
      },
      {
        id: 'create-category-2',
        method: 'POST',
        path: '/channels/categories',
        body: {
          name: 'Category 2 {{timestamp}}',
          displayOrder: 20,
        },
        expectedStatus: 201,
        description: '분류 2 생성',
        extractFromResponse: { category2Id: 'id' },
      },
      {
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel with Category {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
          categoryId: '{{category1Id}}',
        },
        expectedStatus: 201,
        description: '분류 1에 연결된 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'verify-category-1',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: '분류 1 연결 확인',
        responseSchema: z.object({
          id: z.string().uuid(),
          categoryId: z.string().uuid(),
          category: z
            .object({
              id: z.string().uuid(),
              name: z.string(),
            })
            .nullable(),
        }),
      },
      {
        id: 'update-to-category-2',
        method: 'PUT',
        path: '/channels/{{channelId}}',
        body: {
          categoryId: '{{category2Id}}',
        },
        expectedStatus: 200,
        description: '분류 2로 변경',
      },
      {
        id: 'verify-category-2',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: '분류 2 연결 확인',
      },
    ],
  },

  {
    id: 'CHAN-003',
    name: '채널 상태 변경 (활성화/비활성화)',
    category: 'PIM > Sales Channels',
    validation: '채널의 활성/비활성 상태를 변경할 수 있는지 확인',
    steps: [
      {
        id: 'create-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Status Test Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '활성 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'deactivate-channel',
        method: 'PUT',
        path: '/channels/{{channelId}}/status',
        body: {
          isActive: false,
        },
        expectedStatus: 200,
        description: '채널 비활성화',
      },
      {
        id: 'verify-inactive',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: '비활성 상태 확인',
        responseSchema: z.object({
          id: z.string().uuid(),
          isActive: z.literal(false),
        }),
      },
      {
        id: 'activate-channel',
        method: 'PUT',
        path: '/channels/{{channelId}}/status',
        body: {
          isActive: true,
        },
        expectedStatus: 200,
        description: '채널 활성화',
      },
      {
        id: 'verify-active',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: '활성 상태 확인',
        responseSchema: z.object({
          id: z.string().uuid(),
          isActive: z.literal(true),
        }),
      },
    ],
  },

  {
    id: 'CHAN-004',
    name: '채널 목록 조회 (필터링 및 페이징)',
    category: 'PIM > Sales Channels',
    validation: '채널 목록 조회 시 페이징과 필터링이 동작하는지 확인',
    steps: [
      {
        id: 'create-channel-1',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel A {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '채널 1 생성 (활성)',
      },
      {
        id: 'create-channel-2',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel B {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '채널 2 생성 (활성)',
      },
      {
        id: 'create-channel-3',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel C {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
          isActive: false,
        },
        expectedStatus: 201,
        description: '채널 3 생성 (비활성)',
      },
      {
        id: 'create-channel-4',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel D {{timestamp}}',
          site: 'phone_order',
          type: 'OFFLINE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '채널 4 생성 (활성)',
      },
      {
        id: 'create-channel-5',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Channel E {{timestamp}}',
          site: 'other',
          type: 'MOBILE_APP',
          isActive: true,
        },
        expectedStatus: 201,
        description: '채널 5 생성 (활성)',
      },
      {
        id: 'list-paginated',
        method: 'GET',
        path: '/channels',
        queryParams: {
          page: '1',
          limit: '3',
        },
        expectedStatus: 200,
        description: '페이징된 목록 조회 (page=1, limit=3)',
        responseSchema: z.object({
          data: z.array(z.any()).max(3),
          total: z.number().min(5),
          page: z.literal(1),
          limit: z.literal(3),
        }),
      },
      {
        id: 'list-active-only',
        method: 'GET',
        path: '/channels',
        queryParams: {
          isActive: 'true',
        },
        expectedStatus: 200,
        description: '활성 채널만 필터링',
        responseSchema: z.object({
          data: z.array(z.any()).min(4),
        }),
      },
    ],
  },

  // ========================================
  // Group 2: 채널 타입별 테스트 (CHAN-005 ~ CHAN-009)
  // ========================================
  {
    id: 'CHAN-005',
    name: 'MARKETPLACE 타입 채널 - Coupang',
    category: 'PIM > Sales Channels',
    validation: 'Coupang MARKETPLACE 채널을 생성하고 타입별 조회 확인',
    steps: [
      {
        id: 'create-coupang-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Coupang Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
          config: {
            accessKey: 'test-access-key',
            secretKey: 'test-secret-key',
          },
        },
        expectedStatus: 201,
        description: 'Coupang 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'get-coupang-channel',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: 'Coupang 채널 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          site: z.literal('coupang'),
          type: z.literal('MARKETPLACE'),
          config: z.any(),
        }),
      },
      {
        id: 'get-marketplace-channels',
        method: 'GET',
        path: '/channels/type/MARKETPLACE',
        expectedStatus: 200,
        description: 'MARKETPLACE 타입 채널 조회',
        responseSchema: z.array(
          z.object({
            id: z.string().uuid(),
            type: z.literal('MARKETPLACE'),
          }),
        ),
      },
    ],
  },

  {
    id: 'CHAN-006',
    name: 'MARKETPLACE 타입 채널 - Naver',
    category: 'PIM > Sales Channels',
    validation: 'Naver MARKETPLACE 채널 생성 및 타입별 조회 확인',
    steps: [
      {
        id: 'create-naver-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Naver Channel {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
          config: {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
          },
        },
        expectedStatus: 201,
        description: 'Naver 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'get-naver-channel',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: 'Naver 채널 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          site: z.literal('naver'),
          type: z.literal('MARKETPLACE'),
        }),
      },
      {
        id: 'get-marketplace-channels',
        method: 'GET',
        path: '/channels/type/MARKETPLACE',
        expectedStatus: 200,
        description: 'MARKETPLACE 타입 채널 목록 조회',
        responseSchema: z.array(
          z.object({
            type: z.literal('MARKETPLACE'),
          }),
        ),
      },
    ],
  },

  {
    id: 'CHAN-007',
    name: 'ONLINE 타입 채널 - Medusa',
    category: 'PIM > Sales Channels',
    validation: 'Medusa ONLINE 채널 생성 및 타입별 조회 확인',
    steps: [
      {
        id: 'create-medusa-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Medusa Channel {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
          apiEndpoint: 'https://medusa.example.com',
          config: {
            baseUrl: 'https://medusa.example.com',
          },
        },
        expectedStatus: 201,
        description: 'Medusa 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'get-medusa-channel',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: 'Medusa 채널 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          site: z.literal('medusa'),
          type: z.literal('ONLINE'),
          apiEndpoint: z.string().nullable(),
        }),
      },
      {
        id: 'get-online-channels',
        method: 'GET',
        path: '/channels/type/ONLINE',
        expectedStatus: 200,
        description: 'ONLINE 타입 채널 조회',
        responseSchema: z.array(
          z.object({
            type: z.literal('ONLINE'),
          }),
        ),
      },
    ],
  },

  {
    id: 'CHAN-008',
    name: 'OFFLINE 타입 채널 - Phone Order',
    category: 'PIM > Sales Channels',
    validation: 'Phone Order OFFLINE 채널 생성 및 타입별 조회 확인',
    steps: [
      {
        id: 'create-phone-order-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Phone Order Channel {{timestamp}}',
          site: 'phone_order',
          type: 'OFFLINE',
          description: '전화 주문 채널',
        },
        expectedStatus: 201,
        description: 'Phone Order 채널 생성',
        extractFromResponse: { channelId: 'id' },
      },
      {
        id: 'get-phone-order-channel',
        method: 'GET',
        path: '/channels/{{channelId}}',
        expectedStatus: 200,
        description: 'Phone Order 채널 조회',
        responseSchema: z.object({
          id: z.string().uuid(),
          site: z.literal('phone_order'),
          type: z.literal('OFFLINE'),
        }),
      },
      {
        id: 'get-offline-channels',
        method: 'GET',
        path: '/channels/type/OFFLINE',
        expectedStatus: 200,
        description: 'OFFLINE 타입 채널 조회',
        responseSchema: z.array(
          z.object({
            type: z.literal('OFFLINE'),
          }),
        ),
      },
    ],
  },

  {
    id: 'CHAN-009',
    name: 'MOBILE_APP 및 SOCIAL_COMMERCE 타입',
    category: 'PIM > Sales Channels',
    validation: 'MOBILE_APP과 SOCIAL_COMMERCE 타입 채널 생성 및 조회 확인',
    steps: [
      {
        id: 'create-mobile-app-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Mobile App Channel {{timestamp}}',
          site: 'other',
          type: 'MOBILE_APP',
          description: '모바일 앱 채널',
        },
        expectedStatus: 201,
        description: 'MOBILE_APP 채널 생성',
        extractFromResponse: { mobileAppChannelId: 'id' },
      },
      {
        id: 'create-social-commerce-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Social Commerce Channel {{timestamp}}',
          site: 'other',
          type: 'SOCIAL_COMMERCE',
          description: '소셜 커머스 채널',
        },
        expectedStatus: 201,
        description: 'SOCIAL_COMMERCE 채널 생성',
        extractFromResponse: { socialChannelId: 'id' },
      },
      {
        id: 'get-mobile-app-channels',
        method: 'GET',
        path: '/channels/type/MOBILE_APP',
        expectedStatus: 200,
        description: 'MOBILE_APP 타입 채널 조회',
        responseSchema: z.array(
          z.object({
            type: z.literal('MOBILE_APP'),
          }),
        ),
      },
      {
        id: 'get-social-commerce-channels',
        method: 'GET',
        path: '/channels/type/SOCIAL_COMMERCE',
        expectedStatus: 200,
        description: 'SOCIAL_COMMERCE 타입 채널 조회',
        responseSchema: z.array(
          z.object({
            type: z.literal('SOCIAL_COMMERCE'),
          }),
        ),
      },
    ],
  },

  // ========================================
  // Group 3: 채널 설정 검증 (CHAN-010 ~ CHAN-013)
  // ========================================
  {
    id: 'CHAN-010',
    name: 'Medusa 설정 검증',
    category: 'PIM > Sales Channels',
    validation: 'Medusa 채널 설정이 올바른지 검증하는 API 확인',
    steps: [
      {
        id: 'validate-medusa-valid',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'medusa',
          config: {
            baseUrl: 'https://medusa.example.com',
          },
        },
        expectedStatus: 200,
        description: 'Medusa 올바른 설정 검증',
        responseSchema: z.object({
          isValid: z.boolean(),
          errors: z.array(z.string()),
        }),
      },
      {
        id: 'validate-medusa-invalid',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'medusa',
          config: {},
        },
        expectedStatus: 200,
        description: 'Medusa 잘못된 설정 검증 (baseUrl 누락)',
        responseSchema: z.object({
          isValid: z.literal(false),
          errors: z.array(z.string()).min(1),
        }),
      },
    ],
  },

  {
    id: 'CHAN-011',
    name: 'Coupang 설정 검증',
    category: 'PIM > Sales Channels',
    validation: 'Coupang 채널 설정이 올바른지 검증하는 API 확인',
    steps: [
      {
        id: 'validate-coupang-valid',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'coupang',
          config: {
            accessKey: 'test-access-key',
            secretKey: 'test-secret-key',
          },
        },
        expectedStatus: 200,
        description: 'Coupang 올바른 설정 검증',
        responseSchema: z.object({
          isValid: z.boolean(),
          errors: z.array(z.string()),
        }),
      },
      {
        id: 'validate-coupang-missing-access-key',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'coupang',
          config: {
            secretKey: 'test-secret-key',
          },
        },
        expectedStatus: 200,
        description: 'Coupang 잘못된 설정 (accessKey 누락)',
        responseSchema: z.object({
          isValid: z.literal(false),
          errors: z.array(z.string()).min(1),
        }),
      },
      {
        id: 'validate-coupang-missing-secret-key',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'coupang',
          config: {
            accessKey: 'test-access-key',
          },
        },
        expectedStatus: 200,
        description: 'Coupang 잘못된 설정 (secretKey 누락)',
        responseSchema: z.object({
          isValid: z.literal(false),
          errors: z.array(z.string()).min(1),
        }),
      },
    ],
  },

  {
    id: 'CHAN-012',
    name: 'Naver 설정 검증',
    category: 'PIM > Sales Channels',
    validation: 'Naver 채널 설정이 올바른지 검증하는 API 확인',
    steps: [
      {
        id: 'validate-naver-valid',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'naver',
          config: {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
          },
        },
        expectedStatus: 200,
        description: 'Naver 올바른 설정 검증',
        responseSchema: z.object({
          isValid: z.boolean(),
          errors: z.array(z.string()),
        }),
      },
      {
        id: 'validate-naver-missing-client-id',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'naver',
          config: {
            clientSecret: 'test-client-secret',
          },
        },
        expectedStatus: 200,
        description: 'Naver 잘못된 설정 (clientId 누락)',
        responseSchema: z.object({
          isValid: z.literal(false),
          errors: z.array(z.string()).min(1),
        }),
      },
      {
        id: 'validate-naver-missing-client-secret',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'naver',
          config: {
            clientId: 'test-client-id',
          },
        },
        expectedStatus: 200,
        description: 'Naver 잘못된 설정 (clientSecret 누락)',
        responseSchema: z.object({
          isValid: z.literal(false),
          errors: z.array(z.string()).min(1),
        }),
      },
    ],
  },

  {
    id: 'CHAN-013',
    name: 'Phone Order 및 Other 설정 검증',
    category: 'PIM > Sales Channels',
    validation: 'Phone Order와 Other는 설정 검증이 필요 없음을 확인',
    steps: [
      {
        id: 'validate-phone-order',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'phone_order',
        },
        expectedStatus: 200,
        description: 'Phone Order 설정 검증 (설정 불필요)',
        responseSchema: z.object({
          isValid: z.boolean(),
          errors: z.array(z.string()),
        }),
      },
      {
        id: 'validate-other',
        method: 'POST',
        path: '/channels/validate',
        body: {
          site: 'other',
        },
        expectedStatus: 200,
        description: 'Other 설정 검증 (설정 불필요)',
        responseSchema: z.object({
          isValid: z.boolean(),
          errors: z.array(z.string()),
        }),
      },
    ],
  },

  // ========================================
  // Group 4: 활성 채널 조회 및 고급 쿼리 (CHAN-014 ~ CHAN-015)
  // ========================================
  {
    id: 'CHAN-014',
    name: '활성 채널 조회',
    category: 'PIM > Sales Channels',
    validation: '활성 채널만 필터링하여 조회할 수 있는지 확인',
    steps: [
      {
        id: 'create-active-channel-1',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Active Channel 1 {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '활성 채널 1 생성',
        extractFromResponse: { activeChannel1Id: 'id' },
      },
      {
        id: 'create-active-channel-2',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Active Channel 2 {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '활성 채널 2 생성',
        extractFromResponse: { activeChannel2Id: 'id' },
      },
      {
        id: 'create-inactive-channel',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Inactive Channel {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
          isActive: false,
        },
        expectedStatus: 201,
        description: '비활성 채널 생성',
        extractFromResponse: { inactiveChannelId: 'id' },
      },
      {
        id: 'get-active-channels',
        method: 'GET',
        path: '/channels/active',
        expectedStatus: 200,
        description: '활성 채널만 조회',
        responseSchema: z.array(
          z.object({
            id: z.string().uuid(),
            isActive: z.literal(true),
          }),
        ),
      },
    ],
  },

  {
    id: 'CHAN-015',
    name: '채널 검색 및 복합 필터',
    category: 'PIM > Sales Channels',
    validation: '채널 이름 검색 및 복합 필터링 기능 확인',
    steps: [
      {
        id: 'create-channel-search-1',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'SearchTest Channel A {{timestamp}}',
          site: 'medusa',
          type: 'ONLINE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '검색용 채널 1 생성',
      },
      {
        id: 'create-channel-search-2',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'SearchTest Channel B {{timestamp}}',
          site: 'naver',
          type: 'MARKETPLACE',
          isActive: true,
        },
        expectedStatus: 201,
        description: '검색용 채널 2 생성',
      },
      {
        id: 'create-channel-search-3',
        method: 'POST',
        path: '/channels',
        body: {
          name: 'Different Name {{timestamp}}',
          site: 'coupang',
          type: 'MARKETPLACE',
          isActive: false,
        },
        expectedStatus: 201,
        description: '다른 이름의 채널 생성',
      },
      {
        id: 'search-by-name',
        method: 'GET',
        path: '/channels',
        queryParams: {
          search: 'SearchTest',
        },
        expectedStatus: 200,
        description: '이름으로 검색',
        responseSchema: z.object({
          data: z.array(z.any()).min(2),
        }),
      },
      {
        id: 'combined-filter',
        method: 'GET',
        path: '/channels',
        queryParams: {
          type: 'MARKETPLACE',
          isActive: 'true',
        },
        expectedStatus: 200,
        description: '타입과 활성 상태 복합 필터',
        responseSchema: z.object({
          data: z.array(
            z.object({
              type: z.literal('MARKETPLACE'),
              isActive: z.literal(true),
            }),
          ),
        }),
      },
    ],
  },
];
