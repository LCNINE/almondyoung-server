'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AdminUsersQuery } from '@/lib/types/dto/user';
import { useState } from 'react';

interface FilterBoxProps {
  onSearch: (filter: Omit<AdminUsersQuery, 'page' | 'limit'>) => void;
}

export function FilterBox({ onSearch }: FilterBoxProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('');

  const handleSearch = () => {
    onSearch({
      username: username || undefined,
      email: email || undefined,
      roleName: roleName || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-md border py-4 px-8 bg-[#F5F5F5]">
      {/* 이름 */}
      <div className="flex flex-col">
        <label className="mb-1 text-sm font-bold">이름</label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="이름 입력"
          className="w-[200px] bg-white"
        />
      </div>

      {/* 이메일 */}
      <div className="flex flex-col">
        <label className="mb-1 text-sm font-bold">이메일</label>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="이메일 입력"
          className="w-[240px] bg-white"
        />
      </div>

      {/* 역할 */}
      <div className="flex flex-col">
        <label className="mb-1 text-sm font-bold">역할</label>
        <Select
          value={roleName}
          onValueChange={(value) => setRoleName(value === 'all' ? '' : value)}
        >
          <SelectTrigger className="w-[140px] bg-white">
            <SelectValue placeholder="전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="master">master</SelectItem>
            <SelectItem value="user">user</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 검색 버튼 */}
      <Button onClick={handleSearch} className="h-10">
        검색
      </Button>
    </div>
  );
}
