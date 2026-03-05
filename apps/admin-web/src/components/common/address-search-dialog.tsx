// src/components/ui/address-search-dialog.tsx
'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, MapPin } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Address {
    zipNo: string;
    rnAdres: string; // 도로명주소
    lnmAdres: string; // 지번주소
}

interface AddressSearchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (address: { zipcode: string; address: string }) => void;
    title?: string;
}

export function AddressSearchDialog({
    open,
    onOpenChange,
    onSelect,
    title = "주소 검색"
}: AddressSearchDialogProps) {
    const [searchType, setSearchType] = useState<'road' | 'dong'>('road');
    const [searchQuery, setSearchQuery] = useState('');
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const countPerPage = 10;

    const searchAddresses = async (page: number = 1) => {
        if (!searchQuery.trim()) {
            setError('검색어를 입력해주세요.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // API 프록시를 통해 호출
            const params = new URLSearchParams({
                searchSe: searchType,
                srchwrd: searchQuery,
                countPerPage: String(countPerPage),
                currentPage: String(page)
            });

            const response = await fetch(`/api/address/search?${params}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '주소 검색에 실패했습니다.');
            }

            setTotalCount(data.totalCount);
            setAddresses(data.addresses);
            setCurrentPage(page);

            if (data.addresses.length === 0) {
                setError('검색 결과가 없습니다. 다른 검색어로 시도해주세요.');
            }
        } catch (err) {
            console.error('Address search error:', err);
            setError(err instanceof Error ? err.message : '주소 검색 중 오류가 발생했습니다.');
            setAddresses([]);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = () => {
        searchAddresses(1);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const handleSelect = (address: Address) => {
        onSelect({
            zipcode: address.zipNo,
            address: address.rnAdres // 도로명주소 사용
        });
        onOpenChange(false);
        // 상태 초기화
        setSearchQuery('');
        setAddresses([]);
        setCurrentPage(1);
        setTotalCount(0);
    };

    const totalPages = Math.ceil(totalCount / countPerPage);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-white">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-gray-900">{title}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* 검색 타입 선택 */}
                    <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                        <button
                            type="button"
                            onClick={() => setSearchType('road')}
                            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${searchType === 'road'
                                ? 'bg-blue-500 text-white'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            도로명 주소
                        </button>
                        <button
                            type="button"
                            onClick={() => setSearchType('dong')}
                            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${searchType === 'dong'
                                ? 'bg-blue-500 text-white'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            지번 주소
                        </button>
                    </div>

                    {/* 검색 입력 */}
                    <div className="flex gap-2">
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder={
                                searchType === 'road'
                                    ? '도로명 주소를 입력하세요 (예: 서문대로 745)'
                                    : '동/읍/면 + 번지를 입력하세요 (예: 주월동 408-1)'
                            }
                            className="flex-1 bg-white border-gray-300"
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={loading}
                            className="bg-blue-500 hover:bg-blue-600 text-white"
                        >
                            {loading ? (
                                <span className="animate-spin">⏳</span>
                            ) : (
                                <Search className="h-4 w-4" />
                            )}
                        </Button>
                    </div>

                    {/* 에러 메시지 */}
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* 검색 결과 */}
                    {addresses.length > 0 && (
                        <>
                            <div className="text-sm text-gray-600">
                                검색 결과: {totalCount}건
                            </div>
                            <ScrollArea className="h-[400px] rounded-lg border border-gray-200 bg-gray-50">
                                <div className="p-2 space-y-1">
                                    {addresses.map((address, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSelect(address)}
                                            className="w-full p-4 text-left rounded-lg hover:bg-blue-50 transition-colors group border border-transparent hover:border-blue-200"
                                        >
                                            <div className="flex items-start gap-3">
                                                <MapPin className="h-5 w-5 text-blue-500 mt-1 flex-shrink-0" />
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="inline-flex px-2 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded">
                                                            {address.zipNo}
                                                        </span>
                                                    </div>
                                                    <div className="text-sm text-gray-900 group-hover:text-blue-600 transition-colors">
                                                        {address.rnAdres}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {address.lnmAdres}
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>

                            {/* 페이지네이션 */}
                            {totalPages > 1 && (
                                <div className="flex justify-center gap-1">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => searchAddresses(currentPage - 1)}
                                        disabled={currentPage === 1 || loading}
                                        className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                        이전
                                    </Button>
                                    <span className="flex items-center px-3 text-sm text-gray-600">
                                        {currentPage} / {totalPages}
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => searchAddresses(currentPage + 1)}
                                        disabled={currentPage === totalPages || loading}
                                        className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                        다음
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}