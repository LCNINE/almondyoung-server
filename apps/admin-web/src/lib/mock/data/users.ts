// src/lib/mock/data/users.ts
// 사용자 관련 Mock 데이터

// 사용자 Mock 데이터
export const mockUsers = [
    {
        id: 'user-1',
        email: 'user1@example.com',
        name: '홍길동',
        phone: '010-1234-5678',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
    {
        id: 'user-2',
        email: 'user2@example.com',
        name: '김철수',
        phone: '010-9876-5432',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 관리자 Mock 데이터
export const mockAdmins = [
    {
        id: 'admin-1',
        email: 'admin@example.com',
        name: '관리자',
        role: 'super_admin',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 동의 Mock 데이터
export const mockConsents = [
    {
        id: 'consent-1',
        user_id: 'user-1',
        type: 'marketing',
        agreed: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];

// 사업자등록증 Mock 데이터
export const mockBusinessLicenses = [
    {
        id: 'license-1',
        user_id: 'user-1',
        business_number: '123-45-67890',
        business_name: '테스트 사업자',
        status: 'approved',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    },
];
