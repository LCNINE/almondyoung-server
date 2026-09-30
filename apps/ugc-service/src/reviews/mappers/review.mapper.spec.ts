import { ReviewMapper } from './review.mapper';
import { ReviewWithMediaEntity } from '../types';

describe('admin review provenance', () => {
  const entity = {
    id: 'review',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    permission: { id: 'permission', provider: 'admin', batchId: 'batch', grantedReason: 'fixture' },
  } as ReviewWithMediaEntity;

  it('returns provenance only through the admin mapper', () => {
    expect(ReviewMapper.toAdminResponse(entity).permission).toEqual(entity.permission);
    expect(ReviewMapper.toResponse(entity)).not.toHaveProperty('permission');
  });

  it('does not infer order permission for unlinked reviews', () => {
    expect(ReviewMapper.toAdminResponse({ ...entity, permission: undefined }).permission).toBeNull();
  });
});

describe('admin review source fields', () => {
  const entity = {
    id: 'review',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    sourceSystem: 'admin-manual',
    createdByAdminUserId: 'admin-1',
    permission: null,
  } as ReviewWithMediaEntity;

  it('출처와 입력자는 관리자 응답에만 실린다', () => {
    const admin = ReviewMapper.toAdminResponse(entity);
    expect(admin.sourceSystem).toBe('admin-manual');
    expect(admin.createdByAdminUserId).toBe('admin-1');

    const pub = ReviewMapper.toResponse(entity);
    expect(pub).not.toHaveProperty('sourceSystem');
    expect(pub).not.toHaveProperty('createdByAdminUserId');
  });

  it('입력자가 없으면 null 이다 (undefined 가 아니다)', () => {
    const admin = ReviewMapper.toAdminResponse({ ...entity, createdByAdminUserId: null });
    expect(admin.createdByAdminUserId).toBeNull();
  });
});

describe('author name masking', () => {
  const base = {
    id: 'review',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    permission: null,
  } as unknown as ReviewWithMediaEntity;

  it('공개 응답은 이름을 가리고 관리자 응답은 원문을 준다', () => {
    const entity = { ...base, legacyAuthorName: '홍길동' } as ReviewWithMediaEntity;
    expect(ReviewMapper.toResponse(entity).legacy_author_name).toBe('홍**');
    expect(ReviewMapper.toAdminResponse(entity).legacy_author_name).toBe('홍길동');
  });

  it('이름이 없으면 양쪽 모두 null 이다', () => {
    const entity = { ...base, legacyAuthorName: null } as ReviewWithMediaEntity;
    expect(ReviewMapper.toResponse(entity).legacy_author_name).toBeNull();
    expect(ReviewMapper.toAdminResponse(entity).legacy_author_name).toBeNull();
  });
});
