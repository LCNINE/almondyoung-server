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
