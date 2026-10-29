import type { AdminUserDto } from '@/lib/types/dto/user';

export interface RegistrantOption {
  value: string;
  label: string;
  group?: string;
}

export const OTHER_STAFF_GROUP = '다른 직원';

/** 상품 등록 권한자를 앞에 두고, 나머지 직원은 «다른 직원» 묶음으로 뒤에 둔다. */
export function buildRegistrantOptions(
  users: readonly AdminUserDto[] | undefined,
  allOption: { value: string; label: string },
): RegistrantOption[] {
  const toOption = (user: AdminUserDto, group?: string): RegistrantOption => ({
    value: user.id,
    label: `${user.loginId} (${user.username})`,
    ...(group ? { group } : {}),
  });
  const list = users ?? [];
  return [
    allOption,
    ...list.filter((user) => user.holdsPermission).map((user) => toOption(user)),
    ...list.filter((user) => !user.holdsPermission).map((user) => toOption(user, OTHER_STAFF_GROUP)),
  ];
}
