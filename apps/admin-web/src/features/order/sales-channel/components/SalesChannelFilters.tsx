// src/features/account-management/sales-channel/components/SalesChannelFilters.tsx
'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import type { SalesChannelQueryDto } from '@/lib/types/dto/products';

type UiSite = { id: string; type: string; name: string; icon?: string; isActive?: boolean };

interface SalesChannelFiltersProps {
    sites: UiSite[];
    filters: SalesChannelQueryDto;
    onFilterChange: (filters: SalesChannelQueryDto) => void;
}

export function SalesChannelFilters({ sites, filters, onFilterChange }: SalesChannelFiltersProps) {
    const handleTypeChange = (value: string) => {
        onFilterChange({ ...filters, type: value === 'all' ? undefined : value });
    };

    const handleSearchChange = (value: string) => {
        onFilterChange({ ...filters, search: value || undefined });
    };

    const clearFilters = () => {
        onFilterChange({ type: undefined, search: undefined });
    };

    return (
        <div className="flex flex-wrap items-center gap-4">
            {/* 채널 타입 필터 */}
            <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">채널 타입:</label>
                <Select value={filters.type || 'all'} onValueChange={handleTypeChange}>
                    <SelectTrigger className="w-48">
                        <SelectValue placeholder="전체" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        {sites.map((site) => (
                            <SelectItem key={site.type} value={site.type}>
                                {site.name}
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
            <Button variant="outline" onClick={clearFilters} className="text-gray-600 hover:text-gray-800">
                초기화
            </Button>
        </div>
    );
}
