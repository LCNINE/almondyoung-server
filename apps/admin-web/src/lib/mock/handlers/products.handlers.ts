// src/lib/mock/handlers/products.handlers.ts
// PIM API MSW 핸들러

import { http, HttpResponse } from 'msw';
import {
    mockCategories,
    mockCategoryTreeResponse,
    mockMasters,
    mockMastersResponse,
    mockVariants,
    mockVariantsResponse,
    mockChannels,
    mockChannelsResponse,
    mockChannelProducts,
    mockChannelProductsResponse,
    mockMatchingTableResponse,
} from '../data/products';
import type {
    CreateCategoryDto,
    UpdateCategoryDto,
    CategoryDto,
    CreateMasterDto,
    UpdateMasterDto,
    MasterDto,
    CreateVariantDto,
    UpdateVariantDto,
    VariantDto,
    CreateChannelDto,
    UpdateChannelDto,
    ChannelDto,
    CreateChannelProductDto,
    UpdateChannelProductDto,
    ChannelProductDto,
    UpdatePricingStrategyDto,
    UpdateVariantStatusDto,
    UpdateChannelStatusDto,
    ValidateChannelConfigDto,
    UpdateChannelProductNameDto,
    UpdateChannelProductStatusDto,
} from '@/lib/types/dto/products';

// ===== 카테고리 핸들러 =====

export const categoryHandlers = [
    // 카테고리 생성
    http.post('/categories', async ({ request }) => {
        const body = await request.json() as CreateCategoryDto;
        const newCategory: CategoryDto = {
            id: `cat-${Date.now()}`,
            name: body.name,
            description: body.description,
            parentId: body.parentId,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return HttpResponse.json(newCategory, { status: 201 });
    }),

    // 카테고리 트리 조회
    http.get('/categories', ({ request }) => {
        const url = new URL(request.url);
        const maxDepth = url.searchParams.get('maxDepth');

        let response = mockCategoryTreeResponse;
        if (maxDepth) {
            // maxDepth에 따른 필터링 로직 (간단한 구현)
            response = {
                ...mockCategoryTreeResponse,
                maxDepth: parseInt(maxDepth),
            };
        }

        return HttpResponse.json(response);
    }),

    // 카테고리 수정
    http.put('/categories/:id', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as UpdateCategoryDto;

        const category = mockCategories.find(c => c.id === id);
        if (!category) {
            return HttpResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedCategory: CategoryDto = {
            ...category,
            name: body.name ?? category.name,
            description: body.description ?? category.description,
            parentId: body.parentId ?? category.parentId,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedCategory);
    }),

    // 카테고리 삭제
    http.delete('/categories/:id', ({ params }) => {
        const { id } = params;
        const category = mockCategories.find(c => c.id === id);

        if (!category) {
            return HttpResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json({ message: '카테고리가 삭제되었습니다.' });
    }),

    // 카테고리 상세 조회
    http.get('/categories/:id', ({ params }) => {
        const { id } = params;
        const category = mockCategories.find(c => c.id === id);

        if (!category) {
            return HttpResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json(category);
    }),

    // 하위 카테고리 조회
    http.get('/categories/:id/children', ({ params }) => {
        const { id } = params;
        const children = mockCategories.filter(c => c.parentId === id);

        return HttpResponse.json(children);
    }),

    // 카테고리 경로 조회
    http.get('/categories/:id/path', ({ params }) => {
        const { id } = params;
        const category = mockCategories.find(c => c.id === id);

        if (!category) {
            return HttpResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 });
        }

        const path = [
            { id: category.id, name: category.name }
        ];

        return HttpResponse.json({
            categoryId: id,
            path,
        });
    }),

    // 카테고리 이동
    http.put('/categories/:id/move', ({ params, request }) => {
        const { id } = params;
        const url = new URL(request.url);
        const newParentId = url.searchParams.get('newParentId');

        const category = mockCategories.find(c => c.id === id);
        if (!category) {
            return HttpResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedCategory = {
            ...category,
            parentId: newParentId,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedCategory);
    }),
];

// ===== 제품 마스터 핸들러 =====

export const masterHandlers = [
    // 제품 마스터 생성
    http.post('/masters', async ({ request }) => {
        const body = await request.json() as any;
        const newMaster = {
            id: `master-${Date.now()}`,
            ...body,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return HttpResponse.json(newMaster, { status: 201 });
    }),

    // 제품 마스터 목록 조회
    http.get('http://localhost:3020/masters', ({ request }) => {
        console.log('🎯 MSW: http://localhost:3020/masters 요청 가로채기');
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        const pricingStrategy = url.searchParams.get('pricingStrategy');
        const brand = url.searchParams.get('brand');
        const categoryId = url.searchParams.get('categoryId');
        const status = url.searchParams.get('status');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');

        let filteredMasters = mockMasters;

        // 필터링
        if (search) {
            filteredMasters = filteredMasters.filter(m =>
                m.name.toLowerCase().includes(search.toLowerCase())
            );
        }
        if (pricingStrategy) {
            filteredMasters = filteredMasters.filter(m => m.pricingStrategy === pricingStrategy);
        }
        if (brand) {
            filteredMasters = filteredMasters.filter(m => m.brand === brand);
        }
        if (categoryId) {
            filteredMasters = filteredMasters.filter(m => m.categories?.some(c => c.id === categoryId));
        }
        if (status) {
            filteredMasters = filteredMasters.filter(m => m.status === status);
        }

        // 페이지네이션
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = filteredMasters.slice(startIndex, endIndex);

        const response = {
            data: paginatedData,
            total: filteredMasters.length,
            page,
            limit,
            totalPages: Math.ceil(filteredMasters.length / limit),
            hasNext: endIndex < filteredMasters.length,
            hasPrev: page > 1,
        };

        return HttpResponse.json(response);
    }),

    // 제품 마스터 상세 조회
    http.get('http://localhost:3020/masters/:id', ({ params }) => {
        console.log('🎯 MSW: http://localhost:3020/masters/:id 요청 가로채기', params.id);
        const { id } = params;
        const master = mockMasters.find(m => m.id === id);

        if (!master) {
            return HttpResponse.json({ error: '제품 마스터를 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json(master);
    }),

    // 제품 마스터 수정
    http.put('http://localhost:3020/masters/:id', async ({ request, params }) => {
        console.log('🎯 MSW: http://localhost:3020/masters/:id PUT 요청 가로채기', params.id);
        const { id } = params;
        const body = await request.json() as any;

        const master = mockMasters.find(m => m.id === id);
        if (!master) {
            return HttpResponse.json({ error: '제품 마스터를 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedMaster = {
            ...master,
            ...body,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedMaster);
    }),

    // 제품 마스터 삭제
    http.delete('http://localhost:3020/masters/:id', ({ params }) => {
        console.log('🎯 MSW: http://localhost:3020/masters/:id DELETE 요청 가로채기', params.id);
        const { id } = params;
        const master = mockMasters.find(m => m.id === id);

        if (!master) {
            return HttpResponse.json({ error: '제품 마스터를 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json({ message: '제품 마스터가 삭제되었습니다.' });
    }),

    // 가격 미리보기
    http.get('http://localhost:3020/masters/:id/price-preview', ({ params }) => {
        console.log('🎯 MSW: http://localhost:3020/masters/:id/price-preview 요청 가로채기', params.id);
        const { id } = params;
        const master = mockMasters.find(m => m.id === id);

        if (!master) {
            return HttpResponse.json({ error: '제품 마스터를 찾을 수 없습니다.' }, { status: 404 });
        }

        const pricePreview = {
            masterId: id,
            basePrice: master.basePrice,
            calculatedPrice: master.basePrice,
            pricingStrategy: master.pricingStrategy,
            appliedRules: [],
        };

        return HttpResponse.json(pricePreview);
    }),

    // 가격 전략 변경
    http.put('http://localhost:3020/masters/:id/pricing', async ({ request, params }) => {
        console.log('🎯 MSW: http://localhost:3020/masters/:id/pricing PUT 요청 가로채기', params.id);
        const { id } = params;
        const body = await request.json() as any;

        const master = mockMasters.find(m => m.id === id);
        if (!master) {
            return HttpResponse.json({ error: '제품 마스터를 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedMaster = {
            ...master,
            pricingStrategy: body.pricingStrategy,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedMaster);
    }),
];

// ===== 제품 변형 핸들러 =====

export const variantHandlers = [
    // 마스터별 제품 변형 조회
    http.get('http://localhost:3020/variants/masters/:masterId', ({ request, params }) => {
        console.log('🎯 MSW: http://localhost:3020/variants/masters/:masterId 요청 가로채기', params.masterId);
        const { masterId } = params;
        const url = new URL(request.url);
        const includePrice = url.searchParams.get('includePrice') !== 'false';
        const status = url.searchParams.get('status');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');

        let filteredVariants = mockVariants.filter(v => v.masterId === masterId);

        if (status) {
            filteredVariants = filteredVariants.filter(v => v.status === status);
        }

        // 가격 정보 포함 여부
        if (!includePrice) {
            filteredVariants = filteredVariants.map(v => ({
                ...v,
                price: undefined,
                calculatedPrice: undefined,
            }));
        }

        // 페이지네이션
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = filteredVariants.slice(startIndex, endIndex);

        const response = {
            data: paginatedData,
            total: filteredVariants.length,
            page,
            limit,
            totalPages: Math.ceil(filteredVariants.length / limit),
            hasNext: endIndex < filteredVariants.length,
            hasPrev: page > 1,
        };

        return HttpResponse.json(response);
    }),

    // 제품 변형 상세 조회
    http.get('http://localhost:3020/variants/:id', ({ params }) => {
        console.log('🎯 MSW: http://localhost:3020/variants/:id 요청 가로채기', params.id);
        const { id } = params;
        const variant = mockVariants.find(v => v.id === id);

        if (!variant) {
            return HttpResponse.json({ error: '제품 변형을 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json(variant);
    }),

    // 제품 변형 수정
    http.put('http://localhost:3020/variants/:id', async ({ request, params }) => {
        console.log('🎯 MSW: http://localhost:3020/variants/:id PUT 요청 가로채기', params.id);
        const { id } = params;
        const body = await request.json() as any;

        const variant = mockVariants.find(v => v.id === id);
        if (!variant) {
            return HttpResponse.json({ error: '제품 변형을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedVariant = {
            ...variant,
            ...body,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedVariant);
    }),

    // 제품 변형 일괄 수정
    http.put('http://localhost:3020/variants/bulk', async ({ request }) => {
        console.log('🎯 MSW: http://localhost:3020/variants/bulk PUT 요청 가로채기');
        const body = await request.json() as any;
        const updatedVariants = body.variants.map((item: any) => {
            const variant = mockVariants.find(v => v.id === item.id);
            if (!variant) return null;

            return {
                ...variant,
                ...item.updates,
                updatedAt: new Date().toISOString(),
            };
        }).filter(Boolean);

        return HttpResponse.json(updatedVariants);
    }),

    // 제품 변형 가격 조회
    http.get('http://localhost:3020/variants/:id/price', ({ params }) => {
        console.log('🎯 MSW: http://localhost:3020/variants/:id/price 요청 가로채기', params.id);
        const { id } = params;
        const variant = mockVariants.find(v => v.id === id);

        if (!variant) {
            return HttpResponse.json({ error: '제품 변형을 찾을 수 없습니다.' }, { status: 404 });
        }

        const variantPrice = {
            variantId: id,
            price: variant.price || 0,
            basePrice: variant.price || 0,
            calculatedPrice: variant.calculatedPrice || variant.price || 0,
            pricingStrategy: 'fixed',
            appliedRules: [],
        };

        return HttpResponse.json(variantPrice);
    }),

    // 제품 변형 상태 수정
    http.put('http://localhost:3020/variants/:id/status', async ({ request, params }) => {
        console.log('🎯 MSW: http://localhost:3020/variants/:id/status PUT 요청 가로채기', params.id);
        const { id } = params;
        const body = await request.json() as any;

        const variant = mockVariants.find(v => v.id === id);
        if (!variant) {
            return HttpResponse.json({ error: '제품 변형을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedVariant = {
            ...variant,
            status: body.status,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedVariant);
    }),
];

// ===== 판매 채널 핸들러 =====

export const channelHandlers = [
    // 판매 채널 생성
    http.post('http://localhost:3020/channels', async ({ request }) => {
        const body = await request.json() as any;
        const newChannel = {
            id: `channel-${Date.now()}`,
            ...body,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return HttpResponse.json(newChannel, { status: 201 });
    }),

    // 판매 채널 목록 조회
    http.get('http://localhost:3020/channels', ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        const type = url.searchParams.get('type');
        const isActive = url.searchParams.get('isActive');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');

        let filteredChannels = mockChannels;

        if (search) {
            filteredChannels = filteredChannels.filter(c =>
                c.name.toLowerCase().includes(search.toLowerCase())
            );
        }
        if (type) {
            filteredChannels = filteredChannels.filter(c => c.type === type);
        }
        if (isActive !== null) {
            filteredChannels = filteredChannels.filter(c => c.isActive === (isActive === 'true'));
        }

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = filteredChannels.slice(startIndex, endIndex);

        const response = {
            data: paginatedData,
            total: filteredChannels.length,
            page,
            limit,
            totalPages: Math.ceil(filteredChannels.length / limit),
            hasNext: endIndex < filteredChannels.length,
            hasPrev: page > 1,
        };

        return HttpResponse.json(response);
    }),

    // 활성 판매 채널 조회
    http.get('http://localhost:3020/channels/active', () => {
        console.log('🎯 MSW: http://localhost:3020/channels/active 요청 가로채기');
        const activeChannels = mockChannels.filter(c => c.isActive);
        return HttpResponse.json(activeChannels);
    }),

    // 판매 채널 상세 조회
    http.get('/channels/:id', ({ params }) => {
        const { id } = params;
        const channel = mockChannels.find(c => c.id === id);

        if (!channel) {
            return HttpResponse.json({ error: '판매 채널을 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json(channel);
    }),

    // 판매 채널 수정
    http.put('/channels/:id', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        const channel = mockChannels.find(c => c.id === id);
        if (!channel) {
            return HttpResponse.json({ error: '판매 채널을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedChannel = {
            ...channel,
            ...body,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedChannel);
    }),

    // 판매 채널 삭제
    http.delete('/channels/:id', ({ params }) => {
        const { id } = params;
        const channel = mockChannels.find(c => c.id === id);

        if (!channel) {
            return HttpResponse.json({ error: '판매 채널을 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json({ message: '판매 채널이 삭제되었습니다.' });
    }),

    // 판매 채널 상태 설정
    http.put('/channels/:id/status', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        const channel = mockChannels.find(c => c.id === id);
        if (!channel) {
            return HttpResponse.json({ error: '판매 채널을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedChannel = {
            ...channel,
            isActive: body.isActive,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedChannel);
    }),

    // 타입별 판매 채널 조회
    http.get('/channels/type/:type', ({ params }) => {
        const { type } = params;
        const channelsByType = mockChannels.filter(c => c.type === type);

        if (channelsByType.length === 0) {
            return HttpResponse.json({ error: '해당 타입의 판매 채널을 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json(channelsByType);
    }),

    // 판매 채널 설정 검증
    http.post('/channels/validate', async ({ request }) => {
        const body = await request.json() as any;

        const validationResponse = {
            isValid: true,
            errors: [] as string[],
        };

        // 간단한 검증 로직
        if (!body.type) {
            validationResponse.isValid = false;
            validationResponse.errors.push('채널 타입은 필수입니다.');
        }

        return HttpResponse.json(validationResponse);
    }),
];

// ===== 채널별 제품 핸들러 =====

export const channelProductHandlers = [
    // 채널별 제품 생성
    http.post('/channel-products', async ({ request }) => {
        const body = await request.json() as any;
        const newChannelProduct = {
            id: `cp-${Date.now()}`,
            ...body,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return HttpResponse.json(newChannelProduct, { status: 201 });
    }),

    // 마스터별 채널 제품 조회
    http.get('/channel-products/masters/:masterId', ({ params }) => {
        const { masterId } = params;
        const channelProducts = mockChannelProducts.filter(cp => cp.masterId === masterId);

        return HttpResponse.json({ channelProducts });
    }),

    // 채널별 제품 조회
    http.get('/channel-products/channels/:channelId', ({ request, params }) => {
        const { channelId } = params;
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        const isActive = url.searchParams.get('isActive');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');

        let filteredChannelProducts = mockChannelProducts.filter(cp => cp.channelId === channelId);

        if (search) {
            filteredChannelProducts = filteredChannelProducts.filter(cp =>
                cp.name?.toLowerCase().includes(search.toLowerCase())
            );
        }
        if (isActive !== null) {
            filteredChannelProducts = filteredChannelProducts.filter(cp => cp.isActive === (isActive === 'true'));
        }

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = filteredChannelProducts.slice(startIndex, endIndex);

        const response = {
            data: paginatedData,
            total: filteredChannelProducts.length,
            page,
            limit,
            totalPages: Math.ceil(filteredChannelProducts.length / limit),
            hasNext: endIndex < filteredChannelProducts.length,
            hasPrev: page > 1,
        };

        return HttpResponse.json(response);
    }),

    // 채널 제품 상세 조회
    http.get('/channel-products/:id', ({ params }) => {
        const { id } = params;
        const channelProduct = mockChannelProducts.find(cp => cp.id === id);

        if (!channelProduct) {
            return HttpResponse.json({ error: '채널 제품을 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json(channelProduct);
    }),

    // 채널 제품 수정
    http.put('/channel-products/:id', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        const channelProduct = mockChannelProducts.find(cp => cp.id === id);
        if (!channelProduct) {
            return HttpResponse.json({ error: '채널 제품을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedChannelProduct = {
            ...channelProduct,
            ...body,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedChannelProduct);
    }),

    // 채널 제품 삭제
    http.delete('/channel-products/:id', ({ params }) => {
        const { id } = params;
        const channelProduct = mockChannelProducts.find(cp => cp.id === id);

        if (!channelProduct) {
            return HttpResponse.json({ error: '채널 제품을 찾을 수 없습니다.' }, { status: 404 });
        }

        return HttpResponse.json({ message: '채널 제품이 삭제되었습니다.' });
    }),

    // 병합된 채널 제품 조회
    http.get('/channel-products/masters/:masterId/channels/:channelId/merged', ({ params }) => {
        const { masterId, channelId } = params;
        const master = mockMasters.find(m => m.id === masterId);
        const channelProduct = mockChannelProducts.find(cp => cp.masterId === masterId && cp.channelId === channelId);

        if (!master || !channelProduct) {
            return HttpResponse.json({ error: '채널 제품을 찾을 수 없습니다.' }, { status: 404 });
        }

        const mergedChannelProduct = {
            master,
            channelProduct,
            mergedData: {
                name: channelProduct.name || master.name,
                description: channelProduct.description || master.description,
                price: channelProduct.price || master.basePrice,
                images: channelProduct.images || master.images || [],
                specifications: { ...master.specifications, ...channelProduct.specifications },
                isActive: channelProduct.isActive,
            },
        };

        return HttpResponse.json(mergedChannelProduct);
    }),

    // 제품명 덮어쓰기
    http.put('/channel-products/:id/name', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        const channelProduct = mockChannelProducts.find(cp => cp.id === id);
        if (!channelProduct) {
            return HttpResponse.json({ error: '채널 제품을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedChannelProduct = {
            ...channelProduct,
            name: body.name,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedChannelProduct);
    }),

    // 채널 제품 상태 설정
    http.put('/channel-products/:id/status', async ({ request, params }) => {
        const { id } = params;
        const body = await request.json() as any;

        const channelProduct = mockChannelProducts.find(cp => cp.id === id);
        if (!channelProduct) {
            return HttpResponse.json({ error: '채널 제품을 찾을 수 없습니다.' }, { status: 404 });
        }

        const updatedChannelProduct = {
            ...channelProduct,
            isActive: body.isActive,
            updatedAt: new Date().toISOString(),
        };

        return HttpResponse.json(updatedChannelProduct);
    }),
];

// ===== 매칭 테이블 핸들러 =====

export const matchingTableHandlers = [
    // 매칭 테이블 데이터 조회 (커스텀 엔드포인트)
    http.get('/matching-table', ({ request }) => {
        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const channelId = url.searchParams.get('channelId');
        const status = url.searchParams.get('status');

        let filteredData = mockMatchingTableResponse.data;

        if (channelId) {
            filteredData = filteredData.filter(row => row.channelProduct.channelId === channelId);
        }
        if (status) {
            filteredData = filteredData.filter(row => row.matchingStatus === status);
        }

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedData = filteredData.slice(startIndex, endIndex);

        const response = {
            data: paginatedData,
            total: filteredData.length,
            page,
            limit,
            totalPages: Math.ceil(filteredData.length / limit),
            hasNext: endIndex < filteredData.length,
            hasPrev: page > 1,
        };

        return HttpResponse.json(response);
    }),
];

// 모든 PIM 핸들러 통합
export const allProductHandlers = [
    ...categoryHandlers,
    ...masterHandlers,
    ...variantHandlers,
    ...channelHandlers,
    ...channelProductHandlers,
    ...matchingTableHandlers,
];