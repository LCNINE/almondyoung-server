// src/features/order/matching/components/table/SearchDialog.tsx
// 검색 및 신규등록 다이얼로그 컴포넌트

'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Search, Plus, X } from 'lucide-react';

interface SearchDialogProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'supplier' | 'holder';
    onSelect: (item: any) => void;
    onCreate: (data: any) => void;
    searchResults: any[];
    isLoading: boolean;
    onSearch: (query: string, filters?: any) => void;
}

export function SearchDialog({
    isOpen,
    onClose,
    type,
    onSelect,
    onCreate,
    searchResults,
    isLoading,
    onSearch,
}: SearchDialogProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createFormData, setCreateFormData] = useState<any>({});

    // 검색 실행
    const handleSearch = () => {
        if (searchQuery.trim()) {
            onSearch(searchQuery.trim());
        }
    };

    // 엔터키로 검색
    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    // 아이템 선택
    const handleSelectItem = (item: any) => {
        onSelect(item);
        onClose();
    };

    // 신규등록 폼 제출
    const handleCreateSubmit = () => {
        onCreate(createFormData);
        setShowCreateForm(false);
        setCreateFormData({});
        onClose();
    };

    // 다이얼로그 닫기 시 초기화
    const handleClose = () => {
        setSearchQuery('');
        setShowCreateForm(false);
        setCreateFormData({});
        onClose();
    };

    const isSupplier = type === 'supplier';
    const title = isSupplier ? '공급처 검색' : '재고소유 검색';

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[80vh]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Search className="h-5 w-5" />
                        {title}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* 검색 영역 */}
                    {!showCreateForm && (
                        <>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <Input
                                        placeholder={`${isSupplier ? '공급처명' : '재고소유명'}을 입력하세요`}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                    />
                                </div>
                                <Button onClick={handleSearch} disabled={isLoading}>
                                    <Search className="h-4 w-4 mr-2" />
                                    검색
                                </Button>
                                <Button variant="outline" onClick={() => setShowCreateForm(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    신규등록
                                </Button>
                            </div>

                            {/* 검색 결과 */}
                            <div className="border rounded-lg">
                                <ScrollArea className="h-64">
                                    {isLoading ? (
                                        <div className="p-4 text-center text-gray-500">
                                            검색 중...
                                        </div>
                                    ) : searchResults.length > 0 ? (
                                        <div className="divide-y">
                                            {searchResults.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="p-4 hover:bg-gray-50 cursor-pointer"
                                                    onClick={() => handleSelectItem(item)}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h4 className="font-medium">{item.name}</h4>
                                                            {isSupplier && item.contactInfo && (
                                                                <div className="text-sm text-gray-500 mt-1">
                                                                    <div>📞 {item.contactInfo.phone}</div>
                                                                    <div>📧 {item.contactInfo.email}</div>
                                                                    <div>📍 {item.contactInfo.address}</div>
                                                                </div>
                                                            )}
                                                            {!isSupplier && (
                                                                <div className="text-sm text-gray-500 mt-1">
                                                                    {item.isOurAsset ? '🏢 자사 자산' : '🏭 3PL 위탁'}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <Button variant="ghost" size="sm">
                                                            선택
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-4 text-center text-gray-500">
                                            검색 결과가 없습니다
                                        </div>
                                    )}
                                </ScrollArea>
                            </div>
                        </>
                    )}

                    {/* 신규등록 폼 */}
                    {showCreateForm && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">
                                    {isSupplier ? '공급처 신규등록' : '재고소유 신규등록'}
                                </h3>
                                <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="name">
                                        {isSupplier ? '공급처명' : '재고소유명'} *
                                    </Label>
                                    <Input
                                        id="name"
                                        value={createFormData.name || ''}
                                        onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                                        placeholder={`${isSupplier ? '공급처명' : '재고소유명'}을 입력하세요`}
                                    />
                                </div>

                                {isSupplier ? (
                                    <>
                                        <div>
                                            <Label htmlFor="phone">전화번호</Label>
                                            <Input
                                                id="phone"
                                                value={createFormData.phone || ''}
                                                onChange={(e) => setCreateFormData({
                                                    ...createFormData,
                                                    contactInfo: { ...createFormData.contactInfo, phone: e.target.value }
                                                })}
                                                placeholder="전화번호를 입력하세요"
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="email">이메일</Label>
                                            <Input
                                                id="email"
                                                type="email"
                                                value={createFormData.email || ''}
                                                onChange={(e) => setCreateFormData({
                                                    ...createFormData,
                                                    contactInfo: { ...createFormData.contactInfo, email: e.target.value }
                                                })}
                                                placeholder="이메일을 입력하세요"
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="address">주소</Label>
                                            <Input
                                                id="address"
                                                value={createFormData.address || ''}
                                                onChange={(e) => setCreateFormData({
                                                    ...createFormData,
                                                    contactInfo: { ...createFormData.contactInfo, address: e.target.value }
                                                })}
                                                placeholder="주소를 입력하세요"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            id="isOurAsset"
                                            checked={createFormData.isOurAsset || false}
                                            onCheckedChange={(checked) => setCreateFormData({ ...createFormData, isOurAsset: checked })}
                                        />
                                        <Label htmlFor="isOurAsset">자사 자산</Label>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button onClick={handleCreateSubmit} className="flex-1">
                                    등록
                                </Button>
                                <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                                    취소
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
