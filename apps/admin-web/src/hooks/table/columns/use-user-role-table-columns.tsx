import { Checkbox } from '@/components/ui/checkbox';
import { RoleDto } from '@/lib/types/dto/user';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';

const columnHelper = createColumnHelper<RoleDto & { isSelected: boolean }>();

type Props = {
  onToggle: (roleId: string, checked: boolean) => void;
};

export const useUserRoleTableColumns = ({ onToggle }: Props) => {
  return useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: () => null,
        cell: ({ row }) => (
          <Checkbox
            checked={row.original.isSelected}
            onCheckedChange={(checked) =>
              onToggle(row.original.roleId, !!checked)
            }
            aria-label="역할 선택"
          />
        ),
      }),
      columnHelper.accessor('name', { header: '역할명' }),
      columnHelper.accessor('description', {
        header: '설명',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
    ],
    [onToggle]
  );
};
