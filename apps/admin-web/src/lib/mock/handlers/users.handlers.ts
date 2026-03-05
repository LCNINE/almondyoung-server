// src/lib/mock/handlers/users.handlers.ts
// 사용자 관련 MSW handlers (기존 User handlers 통합)

import { http, HttpResponse } from 'msw';
import { mockUsers, mockAdmins, mockConsents, mockBusinessLicenses } from '../data/users';

// 사용자 관련 handlers
export const userHandlers = [
    // 현재 사용자 정보 조회
    http.get('http://localhost:3030/users/me', () => {
        console.log('🎯 MSW: http://localhost:3030/users/me 요청 가로채기');
        return HttpResponse.json({
            id: 'user-1',
            loginId: 'admin',
            username: '관리자',
            email: 'admin@almondyoung.com',
            isEmailVerified: true,
            lastActivityAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }),

    // 현재 사용자 역할 조회
    http.get('http://localhost:3030/users/roles', () => {
        console.log('🎯 MSW: http://localhost:3030/users/roles 요청 가로채기');
        return HttpResponse.json({
            roles: ['admin', 'manager'],
            permissions: ['read', 'write', 'delete'],
        });
    }),

    // 사용자 목록 조회
    http.get('/api/user/users', () => {
        return HttpResponse.json(mockUsers);
    }),

    // 특정 사용자 조회
    http.get('/api/user/users/:id', ({ params }) => {
        const user = mockUsers.find(u => u.id === params.id);
        if (!user) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(user);
    }),

    // 사용자 상세 조회
    http.get('/api/user/users/:id/details', ({ params }) => {
        const user = mockUsers.find(u => u.id === params.id);
        if (!user) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json({ ...user, details: 'extended user details' });
    }),

    // 사용자 역할 조회
    http.get('/api/user/users/:id/roles', () => {
        return HttpResponse.json([]);
    }),

    // 이메일로 사용자 조회
    http.get('/api/user/users/email/:email', ({ params }) => {
        const user = mockUsers.find(u => u.email === params.email);
        if (!user) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(user);
    }),

    // 사용자 프로필 수정
    http.put('/api/user/users/:id/profile', async ({ params, request }) => {
        const updatedData = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: params.id, ...updatedData });
    }),
];

// 관리자 관련 handlers
export const adminHandlers = [
    // 관리자 목록 조회
    http.get('/api/user/admins', () => {
        return HttpResponse.json(mockAdmins);
    }),

    // 특정 관리자 조회
    http.get('/api/user/admins/:id', ({ params }) => {
        const admin = mockAdmins.find(a => a.id === params.id);
        if (!admin) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(admin);
    }),
];

// 동의 관련 handlers
export const consentHandlers = [
    // 동의 목록 조회
    http.get('/api/user/consents', () => {
        return HttpResponse.json(mockConsents);
    }),

    // 특정 동의 조회
    http.get('/api/user/consents/:id', ({ params }) => {
        const consent = mockConsents.find(c => c.id === params.id);
        if (!consent) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(consent);
    }),

    // 사용자별 동의 조회
    http.get('/api/user/consents/user/:userId', ({ params }) => {
        const userConsents = mockConsents.filter(c => c.user_id === params.userId);
        return HttpResponse.json(userConsents);
    }),
];

// 사업자등록증 관련 handlers
export const businessLicenseHandlers = [
    // 사업자등록증 목록 조회
    http.get('/api/user/business-licenses', () => {
        return HttpResponse.json(mockBusinessLicenses);
    }),

    // 특정 사업자등록증 조회
    http.get('/api/user/business-licenses/:id', ({ params }) => {
        const license = mockBusinessLicenses.find(l => l.id === params.id);
        if (!license) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(license);
    }),

    // 사용자별 사업자등록증 조회
    http.get('/api/user/business-licenses/user/:userId', ({ params }) => {
        const userLicense = mockBusinessLicenses.find(l => l.user_id === params.userId);
        if (!userLicense) {
            return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(userLicense);
    }),
];

// 쇼핑몰 정보 관련 handlers
export const shopInfoHandlers = [
    // 쇼핑몰 정보 조회
    http.get('/api/user/shop-info/:userId', ({ params }) => {
        return HttpResponse.json({ userId: params.userId, shopName: 'Test Shop' });
    }),

    // 쇼핑몰 정보 생성
    http.post('/api/user/shop-info', async ({ request }) => {
        const newShopInfo = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ id: 'new-shop-info-id', ...newShopInfo }, { status: 201 });
    }),

    // 쇼핑몰 정보 수정
    http.put('/api/user/shop-info/:userId', async ({ params, request }) => {
        const updatedData = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ userId: params.userId, ...updatedData });
    }),
];

// 모든 사용자 관련 handlers 통합
export const allUserHandlers = [
    ...userHandlers,
    ...adminHandlers,
    ...consentHandlers,
    ...businessLicenseHandlers,
    ...shopInfoHandlers,
];
