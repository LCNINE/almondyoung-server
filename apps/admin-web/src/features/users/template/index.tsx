'use client';

import { AdminUsersQuery } from '@/lib/types/dto/user';
import { useState } from 'react';
import { FilterBox } from '../components/filter-box';
import { UserTable } from '../components/table';

export default function UserListTemplate() {
  const [filter, setFilter] = useState<Omit<AdminUsersQuery, 'page' | 'limit'>>({});
  const [page, setPage] = useState(1);

  const handleSearch = (newFilter: Omit<AdminUsersQuery, 'page' | 'limit'>) => {
    setFilter(newFilter);
    setPage(1);
  };

  const query: AdminUsersQuery = {
    ...filter,
    page,
    limit: 20,
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterBox onSearch={handleSearch} />
      <UserTable query={query} onPageChange={setPage} />
    </div>
  );
}
