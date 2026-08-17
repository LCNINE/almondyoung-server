'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { SALES_CHANNEL_SITE_OPTIONS } from '@/lib/api/domains/sales-channel/vocabulary';

type FilterState = { site?: string; search?: string };

interface SalesChannelFiltersProps {
  filters: FilterState;
  onFilterChange: (updates: Record<string, string | undefined>) => void;
}

export function SalesChannelFilters({
  filters,
  onFilterChange,
}: SalesChannelFiltersProps) {
  const handleSiteChange = (value: string) => {
    onFilterChange({ site: value === 'all' ? undefined : value });
  };

  const handleSearchChange = (value: string) => {
    onFilterChange({ search: value || undefined });
  };

  const clearFilters = () => {
    onFilterChange({ site: undefined, search: undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* 판매처 필터 */}
      <div className="flex items-center space-x-2">
        <label className="text-sm font-medium text-gray-700">판매처:</label>
        <Select value={filters.site || 'all'} onValueChange={handleSiteChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            {SALES_CHANNEL_SITE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 검색 */}
      <div className="flex items-center space-x-2">
        <label className="text-sm font-medium text-gray-700">검색:</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="판매처명으로 검색..."
            value={filters.search || ''}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 w-64"
          />
        </div>
      </div>

      {/* 필터 초기화 */}
      <Button
        variant="outline"
        onClick={clearFilters}
        className="text-gray-600 hover:text-gray-800"
      >
        초기화
      </Button>
    </div>
  );
}
