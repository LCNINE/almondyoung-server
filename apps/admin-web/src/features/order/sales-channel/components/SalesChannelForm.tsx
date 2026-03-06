// src/features/account-management/sales-channel/components/SalesChannelForm.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import {
    useSalesChannelSites,
    useCreateChannel,
    useUpdateChannel,
} from '@/lib/services/products';
import type { ChannelDto as SalesChannel } from '@/lib/types/dto/products';

type UiSite = { id: string; type: string; name: string; icon?: string; isActive?: boolean };

interface SalesChannelFormProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    editingChannel?: SalesChannel | null;
}

export function SalesChannelForm({ open, onOpenChange, onSuccess, editingChannel }: SalesChannelFormProps) {
    const [addressSearchOpen, setAddressSearchOpen] = useState(false);
    const [formData, setFormData] = useState({
        type: '',
        name: '',
        // 로그인/보안
        loginId: '',
        password: '',
        hasOtp: false,
        // 키류
        apiKey: '',
        accessKey: '',
        secretKey: '',
        // 부가(모두 apiConfig로 감쌈)
        memo: '',
        feeRate: '',
        smartstoreUrl: '',
        companyCode: '',
        // 출고지
        shipperName: '',
        shipperPhone: '',
        shipperZip: '',
        shipperAddress: '',
        // 활성화 (수정시에만 반영)
        isActive: true,
    });

    // 채널 타입 목록(프런트 전용)
    const { data: sites = [], isLoading: sitesLoading } = useSalesChannelSites('all');

    // 뮤테이션
    const createChannel = useCreateChannel();
    const updateChannel = useUpdateChannel();

    const selectedType = useMemo(() => formData.type || (editingChannel?.type ?? ''), [formData.type, editingChannel]);
    const isSmartstore = selectedType === 'naver_smartstore';
    const isCoupang = selectedType === 'coupang';

    // 폼 초기화
    const resetForm = () => {
        setFormData({
            type: '',
            name: '',
            loginId: '',
            password: '',
            hasOtp: false,
            apiKey: '',
            accessKey: '',
            secretKey: '',
            memo: '',
            feeRate: '',
            smartstoreUrl: '',
            companyCode: '',
            shipperName: '',
            shipperPhone: '',
            shipperZip: '',
            shipperAddress: '',
            isActive: true,
        });
    };

    // 편집 모드 → 기존 데이터 맵핑
    useEffect(() => {
        if (editingChannel) {
            const cfg = (editingChannel.config || {}) as Record<string, unknown>;
            setFormData({
                type: editingChannel.type || '',
                name: editingChannel.name || '',
                loginId: (cfg.loginId as string) || '',
                password: (cfg.password as string) || '',
                hasOtp: Boolean(cfg.hasOtp),
                apiKey: (cfg.apiKey as string) || (cfg.accessKey as string) || '',
                accessKey: (cfg.accessKey as string) || '',
                secretKey: (cfg.secretKey as string) || '',
                memo: (cfg.memo as string) || '',
                feeRate: cfg.feeRate != null ? String(cfg.feeRate) : '',
                smartstoreUrl: (cfg.smartstoreUrl as string) || '',
                companyCode: (cfg.companyCode as string) || '',
                shipperName: ((cfg.shipper as any)?.name as string) || '',
                shipperPhone: ((cfg.shipper as any)?.phone as string) || '',
                shipperZip: ((cfg.shipper as any)?.zipcode as string) || '',
                shipperAddress: ((cfg.shipper as any)?.address as string) || '',
                isActive: editingChannel.isActive ?? true,
            });
        } else {
            resetForm();
        }
    }, [editingChannel, open]);

    // 주소 선택
    const handleAddressSelect = (address: { zipcode: string; address: string }) => {
        setFormData((prev) => ({
            ...prev,
            shipperZip: address.zipcode,
            shipperAddress: address.address,
        }));
        setAddressSearchOpen(false);
    };

    // 제출
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const type = selectedType;
        if (!type || !formData.name) return;

        const shipper:
            | {
                name: string;
                phone: string;
                zipcode: string;
                address: string;
            }
            | undefined =
            formData.shipperName || formData.shipperPhone || formData.shipperZip || formData.shipperAddress
                ? {
                    name: formData.shipperName,
                    phone: formData.shipperPhone,
                    zipcode: formData.shipperZip,
                    address: formData.shipperAddress,
                }
                : undefined;

        const keyPayload = isCoupang
            ? { accessKey: formData.accessKey || formData.apiKey || undefined, secretKey: formData.secretKey || undefined }
            : isSmartstore
                ? { apiKey: formData.apiKey || undefined }
                : { apiKey: formData.apiKey || undefined };

        const apiConfig = {
            loginId: formData.loginId || undefined,
            password: formData.password || undefined,
            hasOtp: formData.hasOtp,
            memo: formData.memo || undefined,
            feeRate: formData.feeRate ? Number(formData.feeRate) : undefined,
            smartstoreUrl: isSmartstore ? (formData.smartstoreUrl || undefined) : undefined,
            companyCode: isCoupang ? (formData.companyCode || undefined) : undefined,
            shipper,
            ...keyPayload,
        };

        try {
            if (editingChannel) {
                await updateChannel.mutateAsync({
                    id: editingChannel.id,
                    data: {
                        type,
                        name: formData.name,
                        isActive: formData.isActive,
                        config: apiConfig,
                    },
                });
            } else {
                await createChannel.mutateAsync({
                    type,
                    name: formData.name,
                    config: apiConfig,
                });
            }
            onSuccess();
        } catch {
            /* Alert로 표시됨 */
        }
    };

    const isLoading = sitesLoading || createChannel.isPending || updateChannel.isPending;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold text-gray-900">
                            {editingChannel ? '판매처 수정' : '판매처 등록'}
                        </DialogTitle>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {(createChannel.error || updateChannel.error) && (
                            <Alert variant="destructive">
                                <AlertDescription>
                                    {editingChannel ? '판매처 수정에 실패했습니다.' : '판매처 등록에 실패했습니다.'}
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* 기본 정보 */}
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                            <h3 className="text-lg font-medium text-gray-900">기본 정보</h3>

                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px] flex items-center gap-1">
                                        <span className="text-red-500">■</span>
                                        판매처명
                                    </Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                                        required
                                        className="flex-1 bg-white border-gray-300"
                                    />
                                </div>

                                {/* 채널 타입 선택 */}
                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px] flex items-center gap-1">
                                        <span className="text-red-500">■</span>
                                        채널 타입
                                    </Label>
                                    <Select
                                        value={selectedType}
                                        onValueChange={(v) => setFormData((p) => ({ ...p, type: v }))}
                                    >
                                        <SelectTrigger className="flex-1 bg-white border-gray-300">
                                            <SelectValue placeholder="채널 타입을 선택하세요" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white">
                                            {(sites as UiSite[]).map((s) => (
                                                <SelectItem key={s.type} value={s.type}>
                                                    {s.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* 활성화(수정시에만 의미있음) */}
                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">활성화</Label>
                                    <Switch
                                        checked={formData.isActive}
                                        onCheckedChange={(checked) => setFormData((p) => ({ ...p, isActive: checked }))}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 로그인 정보 */}
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                            <h3 className="text-lg font-medium text-gray-900">로그인 정보</h3>

                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">로그인 ID</Label>
                                    <Input
                                        value={formData.loginId}
                                        onChange={(e) => setFormData((p) => ({ ...p, loginId: e.target.value }))}
                                        placeholder="로그인 ID"
                                        className="flex-1 bg-white border-gray-300"
                                    />
                                </div>

                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">비밀번호</Label>
                                    <Input
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                                        placeholder="비밀번호"
                                        className="flex-1 bg-white border-gray-300"
                                    />
                                </div>

                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">OTP 사용</Label>
                                    <Switch
                                        checked={formData.hasOtp}
                                        onCheckedChange={(checked) => setFormData((p) => ({ ...p, hasOtp: checked }))}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* API 키 정보 */}
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                            <h3 className="text-lg font-medium text-gray-900">API 키 정보</h3>

                            <div className="grid grid-cols-1 gap-4">
                                {isCoupang ? (
                                    <>
                                        <div className="flex items-center gap-4">
                                            <Label className="text-gray-900 min-w-[100px]">Access Key</Label>
                                            <Input
                                                value={formData.accessKey}
                                                onChange={(e) => setFormData((p) => ({ ...p, accessKey: e.target.value }))}
                                                placeholder="쿠팡 Access Key"
                                                className="flex-1 bg-white border-gray-300"
                                            />
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <Label className="text-gray-900 min-w-[100px]">Secret Key</Label>
                                            <Input
                                                type="password"
                                                value={formData.secretKey}
                                                onChange={(e) => setFormData((p) => ({ ...p, secretKey: e.target.value }))}
                                                placeholder="쿠팡 Secret Key"
                                                className="flex-1 bg-white border-gray-300"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center gap-4">
                                        <Label className="text-gray-900 min-w-[100px]">API Key</Label>
                                        <Input
                                            value={formData.apiKey}
                                            onChange={(e) => setFormData((p) => ({ ...p, apiKey: e.target.value }))}
                                            placeholder="API Key"
                                            className="flex-1 bg-white border-gray-300"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 사이트별 추가(타입별 추가) */}
                        {(isSmartstore || isCoupang) && (
                            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                                <h3 className="text-lg font-medium text-gray-900">타입별 추가 정보</h3>

                                <div className="grid grid-cols-1 gap-4">
                                    {isSmartstore && (
                                        <div className="flex items-center gap-4">
                                            <Label className="text-gray-900 min-w-[100px]">스마트스토어 URL</Label>
                                            <Input
                                                value={formData.smartstoreUrl}
                                                onChange={(e) => setFormData((p) => ({ ...p, smartstoreUrl: e.target.value }))}
                                                placeholder="https://smartstore.naver.com/..."
                                                className="flex-1 bg-white border-gray-300"
                                            />
                                        </div>
                                    )}

                                    {isCoupang && (
                                        <div className="flex items-center gap-4">
                                            <Label className="text-gray-900 min-w-[100px]">업체 코드</Label>
                                            <Input
                                                value={formData.companyCode}
                                                onChange={(e) => setFormData((p) => ({ ...p, companyCode: e.target.value }))}
                                                placeholder="쿠팡 업체 코드"
                                                className="flex-1 bg-white border-gray-300"
                                            />
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4">
                                        <Label className="text-gray-900 min-w-[100px]">수수료율 (%)</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={formData.feeRate}
                                            onChange={(e) => setFormData((p) => ({ ...p, feeRate: e.target.value }))}
                                            placeholder="수수료율 (예: 5.5)"
                                            className="flex-1 bg-white border-gray-300"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 출고지 정보 */}
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                            <h3 className="text-lg font-medium text-gray-900">출고지 정보</h3>

                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">출고지명</Label>
                                    <Input
                                        value={formData.shipperName}
                                        onChange={(e) => setFormData((p) => ({ ...p, shipperName: e.target.value }))}
                                        placeholder="출고지명"
                                        className="flex-1 bg-white border-gray-300"
                                    />
                                </div>

                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">연락처</Label>
                                    <Input
                                        value={formData.shipperPhone}
                                        onChange={(e) => setFormData((p) => ({ ...p, shipperPhone: e.target.value }))}
                                        placeholder="연락처"
                                        className="flex-1 bg-white border-gray-300"
                                    />
                                </div>

                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">우편번호</Label>
                                    <div className="flex flex-1 gap-2">
                                        <Input
                                            value={formData.shipperZip}
                                            onChange={(e) => setFormData((p) => ({ ...p, shipperZip: e.target.value }))}
                                            placeholder="우편번호"
                                            className="flex-1 bg-white border-gray-300"
                                            readOnly
                                        />
                                        <Button type="button" variant="outline" onClick={() => setAddressSearchOpen(true)}>
                                            주소검색
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <Label className="text-gray-900 min-w-[100px]">주소</Label>
                                    <Input
                                        value={formData.shipperAddress}
                                        onChange={(e) => setFormData((p) => ({ ...p, shipperAddress: e.target.value }))}
                                        placeholder="상세주소"
                                        className="flex-1 bg-white border-gray-300"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 제출 */}
                        <div className="flex justify-end space-x-2 pt-4">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                                취소
                            </Button>
                            <Button type="submit" disabled={isLoading || !selectedType || !formData.name}>
                                {isLoading ? '처리 중...' : editingChannel ? '수정' : '등록'}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {/* 주소 검색 다이얼로그 */}
            <AddressSearchDialog
                open={addressSearchOpen}
                onOpenChange={setAddressSearchOpen}
                onSelect={handleAddressSelect}
                title="우편번호 찾기"
            />
        </>
    );
}
