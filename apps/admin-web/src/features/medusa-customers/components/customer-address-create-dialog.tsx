'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateMedusaCustomerAddress } from '@/lib/services/medusa-customers';
import type { AdminCustomer } from '@medusajs/types';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

type AddressFormState = {
  addressName: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string;
  province: string;
  city: string;
  countryCode: string;
  isDefaultShipping: boolean;
};

const getCustomerName = (customer?: AdminCustomer | null) =>
  [customer?.last_name, customer?.first_name].filter(Boolean).join('').trim();

const initialAddressForm = (customer?: AdminCustomer | null): AddressFormState => {
  const customerName = getCustomerName(customer);

  return {
    addressName: customerName,
    recipientName: customerName,
    phone: customer?.phone ?? '',
    postalCode: '',
    address1: '',
    address2: '',
    province: '',
    city: '',
    countryCode: 'kr',
    isDefaultShipping: true,
  };
};

export function CustomerAddressCreateDialog({
  customer,
}: {
  customer?: AdminCustomer | null;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AddressFormState>(() => initialAddressForm(customer));
  const createAddress = useCreateMedusaCustomerAddress(customer?.id ?? '');

  const updateField = <K extends keyof AddressFormState>(key: K, value: AddressFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setForm(initialAddressForm(customer));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const addressName = form.addressName.trim();
    const recipientName = form.recipientName.trim();
    const address1 = form.address1.trim();
    const postalCode = form.postalCode.trim();
    const countryCode = form.countryCode.trim().toLowerCase();

    if (!customer?.id) {
      toast.error('고객 정보를 찾을 수 없습니다.');
      return;
    }
    if (!addressName || !recipientName || !address1 || !postalCode) {
      toast.error('필수 항목을 입력해주세요.');
      return;
    }
    if (countryCode.length !== 2) {
      toast.error('국가 코드는 2자리로 입력해주세요.');
      return;
    }

    try {
      await createAddress.mutateAsync({
        address_name: addressName,
        first_name: recipientName,
        last_name: null,
        phone: form.phone.trim() || null,
        address_1: address1,
        address_2: form.address2.trim() || null,
        city: form.city.trim() || null,
        province: form.province.trim() || null,
        postal_code: postalCode,
        country_code: countryCode,
        is_default_shipping: form.isDefaultShipping,
        is_default_billing: false,
      });
      toast.success('배송지가 등록되었습니다.');
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '배송지 등록에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          배송지 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>배송지 등록</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="address-name">배송지 이름</Label>
              <Input
                id="address-name"
                value={form.addressName}
                onChange={(event) => updateField('addressName', event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient-name">수취인명</Label>
              <Input
                id="recipient-name"
                value={form.recipientName}
                onChange={(event) => updateField('recipientName', event.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient-phone">연락처</Label>
              <Input
                id="recipient-phone"
                value={form.phone}
                onChange={(event) => updateField('phone', event.target.value)}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal-code">우편번호</Label>
              <Input
                id="postal-code"
                value={form.postalCode}
                onChange={(event) => updateField('postalCode', event.target.value)}
                autoComplete="postal-code"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address-1">주소</Label>
              <Input
                id="address-1"
                value={form.address1}
                onChange={(event) => updateField('address1', event.target.value)}
                autoComplete="address-line1"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address-2">상세주소</Label>
              <Input
                id="address-2"
                value={form.address2}
                onChange={(event) => updateField('address2', event.target.value)}
                autoComplete="address-line2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="province">시/도</Label>
              <Input
                id="province"
                value={form.province}
                onChange={(event) => updateField('province', event.target.value)}
                autoComplete="address-level1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">시/군/구</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(event) => updateField('city', event.target.value)}
                autoComplete="address-level2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country-code">국가 코드</Label>
              <Input
                id="country-code"
                value={form.countryCode}
                onChange={(event) => updateField('countryCode', event.target.value)}
                autoComplete="country"
              />
            </div>
            <div className="flex items-center gap-2 pt-7">
              <Checkbox
                id="default-shipping"
                checked={form.isDefaultShipping}
                onCheckedChange={(checked) => updateField('isDefaultShipping', checked === true)}
              />
              <Label htmlFor="default-shipping">기본 배송지</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={createAddress.isPending}>
              취소
            </Button>
            <Button type="submit" disabled={createAddress.isPending}>
              {createAddress.isPending ? '등록 중' : '등록'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
