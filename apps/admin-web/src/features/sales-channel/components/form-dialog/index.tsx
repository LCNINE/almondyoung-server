'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import { useCreateChannel, useUpdateChannel } from '@/lib/api/domains/sales-channel';
import {
  SALES_CHANNEL_SITE_OPTIONS,
  CHANNEL_TYPE_OPTIONS,
  siteLabel,
} from '@/lib/api/domains/sales-channel/vocabulary';
import {
  buildCreatePayload,
  buildUpdatePayload,
  type SalesChannelFormState,
} from '../../form-payload';
import type { ChannelDto as SalesChannel } from '@/lib/types/dto/products';

interface SalesChannelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editingChannel?: SalesChannel | null;
}

export function SalesChannelForm({
  open,
  onOpenChange,
  onSuccess,
  editingChannel,
}: SalesChannelFormProps) {
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [formData, setFormData] = useState<SalesChannelFormState>({
    site: '',
    type: '',
    name: '',
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

  // 뮤테이션
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();

  const isNaver = formData.site === 'naver';
  const isCoupang = formData.site === 'coupang';

  // 폼 초기화
  const resetForm = () => {
    setFormData({
      site: '',
      type: '',
      name: '',
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
        site: editingChannel.site || '',
        type: editingChannel.type || '',
        name: editingChannel.name || '',
        memo: (cfg.memo as string) || '',
        feeRate:
          cfg.feeRate != null
            ? String(cfg.feeRate as string | number | boolean)
            : '',
        smartstoreUrl: (cfg.smartstoreUrl as string) || '',
        companyCode: (cfg.companyCode as string) || '',
        shipperName:
          ((cfg.shipper as Record<string, unknown>)?.name as string) || '',
        shipperPhone:
          ((cfg.shipper as Record<string, unknown>)?.phone as string) || '',
        shipperZip:
          ((cfg.shipper as Record<string, unknown>)?.zipcode as string) || '',
        shipperAddress:
          ((cfg.shipper as Record<string, unknown>)?.address as string) || '',
        isActive: editingChannel.isActive ?? true,
      });
    } else {
      resetForm();
    }
  }, [editingChannel, open]);

  // 주소 선택
  const handleAddressSelect = (address: {
    zipcode: string;
    address: string;
  }) => {
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

    try {
      if (editingChannel) {
        await updateChannel.mutateAsync({
          id: editingChannel.id,
          data: buildUpdatePayload(formData),
        });
      } else {
        const payload = buildCreatePayload(formData);
        if (!payload) return;
        await createChannel.mutateAsync(payload);
      }
      onSuccess();
    } catch {
      /* Alert로 표시됨 */
    }
  };

  const isLoading = createChannel.isPending || updateChannel.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-900">
              {editingChannel ? '판매처 수정' : '판매처 등록'}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-6"
          >
            {(createChannel.error || updateChannel.error) && (
              <Alert variant="destructive">
                <AlertDescription>
                  {editingChannel
                    ? '판매처 수정에 실패했습니다.'
                    : '판매처 등록에 실패했습니다.'}
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
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, name: e.target.value }))
                    }
                    required
                    className="flex-1 bg-white border-gray-300"
                  />
                </div>

                {/* 채널 정체 — sales_channels.site. 만든 뒤에는 바꿀 수 없다. */}
                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px] flex items-center gap-1">
                    <span className="text-red-500">■</span>
                    판매처
                  </Label>
                  {editingChannel ? (
                    <div className="flex-1 text-sm text-gray-700">
                      {siteLabel(formData.site)}
                      <span className="ml-2 text-xs text-gray-500">
                        (등록 후에는 변경할 수 없습니다)
                      </span>
                    </div>
                  ) : (
                    <Select
                      value={formData.site}
                      onValueChange={(v) =>
                        setFormData((p) => ({ ...p, site: v }))
                      }
                    >
                      <SelectTrigger className="flex-1 bg-white border-gray-300">
                        <SelectValue placeholder="판매처를 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {SALES_CHANNEL_SITE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* 채널 형태 — sales_channels.type */}
                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px]">채널 형태</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(v) =>
                      setFormData((p) => ({ ...p, type: v }))
                    }
                  >
                    <SelectTrigger className="flex-1 bg-white border-gray-300">
                      <SelectValue placeholder="온라인" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {CHANNEL_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
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
                    onCheckedChange={(checked) =>
                      setFormData((p) => ({ ...p, isActive: checked }))
                    }
                  />
                </div>
              </div>
            </div>

            {/* 사이트별 추가(타입별 추가) */}
            {(isNaver || isCoupang) && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-medium text-gray-900">
                  타입별 추가 정보
                </h3>

                <div className="grid grid-cols-1 gap-4">
                  {isNaver && (
                    <div className="flex items-center gap-4">
                      <Label className="text-gray-900 min-w-[100px]">
                        스마트스토어 URL
                      </Label>
                      <Input
                        value={formData.smartstoreUrl}
                        onChange={(e) =>
                          setFormData((p) => ({
                            ...p,
                            smartstoreUrl: e.target.value,
                          }))
                        }
                        placeholder="https://smartstore.naver.com/..."
                        className="flex-1 bg-white border-gray-300"
                      />
                    </div>
                  )}

                  {isCoupang && (
                    <div className="flex items-center gap-4">
                      <Label className="text-gray-900 min-w-[100px]">
                        업체 코드
                      </Label>
                      <Input
                        value={formData.companyCode}
                        onChange={(e) =>
                          setFormData((p) => ({
                            ...p,
                            companyCode: e.target.value,
                          }))
                        }
                        placeholder="쿠팡 업체 코드"
                        className="flex-1 bg-white border-gray-300"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <Label className="text-gray-900 min-w-[100px]">
                      수수료율 (%)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.feeRate}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, feeRate: e.target.value }))
                      }
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
                  <Label className="text-gray-900 min-w-[100px]">
                    출고지명
                  </Label>
                  <Input
                    value={formData.shipperName}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        shipperName: e.target.value,
                      }))
                    }
                    placeholder="출고지명"
                    className="flex-1 bg-white border-gray-300"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px]">연락처</Label>
                  <Input
                    value={formData.shipperPhone}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        shipperPhone: e.target.value,
                      }))
                    }
                    placeholder="연락처"
                    className="flex-1 bg-white border-gray-300"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px]">
                    우편번호
                  </Label>
                  <div className="flex flex-1 gap-2">
                    <Input
                      value={formData.shipperZip}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          shipperZip: e.target.value,
                        }))
                      }
                      placeholder="우편번호"
                      className="flex-1 bg-white border-gray-300"
                      readOnly
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setAddressSearchOpen(true)}
                    >
                      주소검색
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Label className="text-gray-900 min-w-[100px]">주소</Label>
                  <Input
                    value={formData.shipperAddress}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        shipperAddress: e.target.value,
                      }))
                    }
                    placeholder="상세주소"
                    className="flex-1 bg-white border-gray-300"
                  />
                </div>
              </div>
            </div>

            {/* 제출 */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={isLoading || (!editingChannel && !formData.site) || !formData.name}
              >
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
