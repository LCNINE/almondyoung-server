import type { AdminUserDto } from '@/lib/types/dto/user';
import { buildRegistrantOptions } from './registrant-options';

const user = (id: string, holdsPermission: boolean): AdminUserDto => ({
  id,
  loginId: id,
  username: `${id}-name`,
  nickname: null,
  email: `${id}@example.test`,
  isEmailVerified: true,
  lastActivityAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  roles: [],
  holdsPermission,
});

describe('registrant options', () => {
  it('lists product writers first and keeps former registrants', () => {
    const options = buildRegistrantOptions([user('a', false), user('b', true), user('c', false)], {
      value: 'all',
      label: '전체 등록자',
    });
    expect(options.map((o) => o.value)).toEqual(['all', 'b', 'a', 'c']);
    expect(options.map((o) => o.group)).toEqual([undefined, undefined, '다른 직원', '다른 직원']);
  });

  it('shows only the all option when there are no users', () => {
    expect(buildRegistrantOptions(undefined, { value: 'all', label: '전체' })).toHaveLength(1);
  });
});
