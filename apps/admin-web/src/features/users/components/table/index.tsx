'use client';

import { DataTable, TableColumn } from '@/components/common/data-table';
import { Pagination } from '@/components/common/pagination';
import { AdminUserDto, AdminUsersQuery } from '@/lib/types/dto/user';
import { useAdminUsers } from '@/lib/services/users';

interface UserTableProps {
  query: AdminUsersQuery;
  onPageChange: (page: number) => void;
}

const columns: TableColumn<AdminUserDto>[] = [
  { key: 'id', label: 'ID', width: '220px' },
  { key: 'loginId', label: '로그인ID', width: '140px' },
  { key: 'username', label: '이름', width: '120px' },
  { key: 'email', label: '이메일', width: '200px' },
  {
    key: 'isEmailVerified',
    label: '이메일인증',
    width: '90px',
    render: (value) => (value ? '인증' : '미인증'),
  },
  {
    key: 'lastActivityAt',
    label: '최근활동일',
    width: '140px',
    render: (value) =>
      value ? new Date(value as string).toLocaleDateString('ko-KR') : '-',
  },
  {
    key: 'createdAt',
    label: '가입일',
    width: '140px',
    render: (value) =>
      value ? new Date(value as string).toLocaleDateString('ko-KR') : '-',
  },
];

export function UserTable({ query, onPageChange }: UserTableProps) {
  const { data, isLoading } = useAdminUsers(query);

  const currentPage = query.page ?? 1;
  const itemsPerPage = query.limit ?? 20;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));

  return (
    <div>
      <DataTable<AdminUserDto>
        data={data?.data ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        emptyMessage="회원 데이터가 없습니다."
      />
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={total}
        itemsPerPage={itemsPerPage}
        onPageChange={onPageChange}
        showItemsPerPage={false}
      />
    </div>
  );
}
