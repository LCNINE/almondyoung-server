'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  medusaCustomerApi,
  type AdminCustomerAddress,
  type MedusaAddressPayload,
} from '@/lib/api/domains/medusa';
import {
  medusaCustomerQueryKeys,
  useCreateMedusaAddress,
  useDeleteMedusaAddress,
  useUpdateMedusaAddress,
} from '@/lib/services/medusa-customers';
import { formatPhoneNumber } from '@/lib/utils/phone';
import { SectionCard } from './_ui';

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message || fallback;
  }
  return fallback;
}

type FormState = {
  first_name: string;
  phone: string;
  postal_code: string;
  address_1: string;
  address_2: string;
  is_default_shipping: boolean;
};

const EMPTY_FORM: FormState = {
  first_name: '',
  phone: '',
  postal_code: '',
  address_1: '',
  address_2: '',
  is_default_shipping: false,
};

export function ShippingAddressesSection({
  medusaCustomerId,
}: {
  medusaCustomerId: string | undefined;
}) {
  const { data, isLoading } = useQuery({
    queryKey: medusaCustomerQueryKeys.detail(medusaCustomerId ?? ''),
    queryFn: () => medusaCustomerApi.getCustomerById(medusaCustomerId!),
    enabled: !!medusaCustomerId,
  });

  const customerId = medusaCustomerId ?? '';
  const createAddr = useCreateMedusaAddress(customerId);
  const updateAddr = useUpdateMedusaAddress(customerId);
  const deleteAddr = useDeleteMedusaAddress(customerId);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const addresses = (data?.customer?.addresses ?? []) as AdminCustomerAddress[];

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (a: AdminCustomerAddress) => {
    setEditingId(a.id);
    setForm({
      first_name: a.first_name ?? '',
      phone: a.phone ?? '',
      postal_code: a.postal_code ?? '',
      address_1: a.address_1 ?? '',
      address_2: a.address_2 ?? '',
      is_default_shipping: !!a.is_default_shipping,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const payload: MedusaAddressPayload = {
      first_name: form.first_name.trim() || undefined,
      phone: form.phone.trim() || undefined,
      postal_code: form.postal_code.trim() || undefined,
      address_1: form.address_1.trim() || undefined,
      address_2: form.address_2.trim() || undefined,
      country_code: 'kr',
      is_default_shipping: form.is_default_shipping,
    };
    try {
      if (editingId) {
        await updateAddr.mutateAsync({ addressId: editingId, payload });
        toast.success('배송지가 수정되었습니다.');
      } else {
        await createAddr.mutateAsync(payload);
        toast.success('배송지가 추가되었습니다.');
      }
      setOpen(false);
    } catch (error) {
      toast.error(errMessage(error, '배송지 저장에 실패했습니다.'));
    }
  };

  const handleDelete = async (addressId: string) => {
    if (!window.confirm('이 배송지를 삭제하시겠습니까?')) return;
    try {
      await deleteAddr.mutateAsync(addressId);
      toast.success('배송지가 삭제되었습니다.');
    } catch (error) {
      toast.error(errMessage(error, '배송지 삭제에 실패했습니다.'));
    }
  };

  const saving = createAddr.isPending || updateAddr.isPending;

  return (
    <SectionCard
      title="배송지 정보"
      icon={<MapPin className="size-4 text-rose-500" />}
      action={
        medusaCustomerId ? (
          <Button type="button" size="sm" variant="outline" onClick={openAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            배송지 추가
          </Button>
        ) : null
      }
    >
      {!medusaCustomerId ? (
        <div className="py-6 text-center text-sm text-gray-400">
          연동된 Medusa 고객이 없어 배송지를 조회할 수 없습니다.
        </div>
      ) : isLoading ? (
        <div className="text-sm text-gray-400">불러오는 중…</div>
      ) : addresses.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          등록된 배송지가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {addresses.map((a) => (
            <div
              key={a.id}
              className="flex items-start justify-between rounded-md border border-gray-100 bg-gray-50 p-3"
            >
              <div className="min-w-0 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {a.first_name || '받는사람 미지정'}
                  </span>
                  {a.is_default_shipping && (
                    <Badge variant="default">기본배송지</Badge>
                  )}
                  {a.phone && (
                    <span className="text-xs text-gray-500">
                      {formatPhoneNumber(a.phone)}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-gray-600">
                  {a.postal_code ? `(${a.postal_code}) ` : ''}
                  {[a.address_1, a.address_2].filter(Boolean).join(' ') || '-'}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => openEdit(a)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-500"
                  onClick={() => handleDelete(a.id)}
                  disabled={deleteAddr.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? '배송지 수정' : '배송지 추가'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-500">받는사람</Label>
              <Input
                value={form.first_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, first_name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-500">연락처</Label>
              <Input
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="01012345678"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-500">우편번호</Label>
              <Input
                value={form.postal_code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, postal_code: e.target.value }))
                }
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-gray-500">주소</Label>
              <Input
                value={form.address_1}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address_1: e.target.value }))
                }
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-gray-500">상세주소</Label>
              <Input
                value={form.address_2}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address_2: e.target.value }))
                }
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch
                checked={form.is_default_shipping}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, is_default_shipping: v }))
                }
              />
              <Label className="text-sm text-gray-700">기본 배송지로 설정</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '저장중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
