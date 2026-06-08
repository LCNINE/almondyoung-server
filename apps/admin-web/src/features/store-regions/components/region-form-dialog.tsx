'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MedusaRegion } from '@/lib/api/domains/medusa/regions';
import {
  useCreateMedusaRegion,
  useUpdateMedusaRegion,
} from '@/lib/services/medusa-regions';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null 이면 생성, 값이 있으면 수정 */
  region: MedusaRegion | null;
}

export function RegionFormDialog({ open, onOpenChange, region }: Props) {
  const isEdit = !!region;
  const createMutation = useCreateMedusaRegion();
  const updateMutation = useUpdateMedusaRegion();
  const pending = createMutation.isPending || updateMutation.isPending;

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [countries, setCountries] = useState('');
  const [automaticTaxes, setAutomaticTaxes] = useState(true);
  const [taxInclusive, setTaxInclusive] = useState(false);

  // dialog 가 열리거나 대상 region 이 바뀌면 폼 초기화
  useEffect(() => {
    if (!open) return;
    setName(region?.name ?? '');
    setCurrency(region?.currency_code ?? '');
    setCountries((region?.countries ?? []).map((c) => c.iso_2).join(', '));
    setAutomaticTaxes(region?.automatic_taxes ?? true);
    setTaxInclusive(region?.is_tax_inclusive ?? false);
  }, [open, region]);

  const parseCountries = (raw: string): string[] =>
    raw
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

  const handleSubmit = async () => {
    const countryList = parseCountries(countries);
    const currencyCode = currency.trim().toLowerCase();

    if (!name.trim()) return toast.error('리전 이름을 입력해 주세요.');
    if (!/^[a-z]{3}$/.test(currencyCode))
      return toast.error('통화 코드는 소문자 3자입니다 (예: krw, usd).');
    if (countryList.length === 0)
      return toast.error('국가코드를 1개 이상 입력해 주세요 (예: kr, us).');
    if (countryList.some((c) => !/^[a-z]{2}$/.test(c)))
      return toast.error(
        '국가코드는 소문자 alpha-2 형식이어야 해요 (예: kr, us).'
      );

    try {
      if (isEdit && region) {
        await updateMutation.mutateAsync({
          id: region.id,
          payload: {
            name: name.trim(),
            currency_code: currencyCode,
            countries: countryList,
            automatic_taxes: automaticTaxes,
            is_tax_inclusive: taxInclusive,
          },
        });
        toast.success('리전을 수정했어요.');
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          currency_code: currencyCode,
          countries: countryList,
          automatic_taxes: automaticTaxes,
          is_tax_inclusive: taxInclusive,
        });
        toast.success('리전을 생성했어요.');
      }
      onOpenChange(false);
    } catch {
      toast.error(
        isEdit
          ? '리전 수정에 실패했어요.'
          : '리전 생성에 실패했어요. (국가/통화 중복일 수 있어요)'
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? '리전 수정' : '리전 추가'}</DialogTitle>
          <DialogDescription>
            Medusa 리전의 통화·국가·세금 설정입니다. 국가코드는 소문자
            alpha-2(kr, us)를 사용하며, 결제수단 관리(리전·결제수단)와 동일한
            코드를 쓰면 정합합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="region-name">이름</Label>
            <Input
              id="region-name"
              placeholder="Korea"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="region-currency">통화 코드 (소문자 3자)</Label>
            <Input
              id="region-currency"
              placeholder="krw"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toLowerCase())}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="region-countries">
              국가코드 (alpha-2, 쉼표로 구분)
            </Label>
            <Input
              id="region-countries"
              placeholder="kr, us"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <Label>자동 세금 계산</Label>
              <span className="text-xs text-muted-foreground">
                체크아웃 시 세금을 자동 계산합니다.
              </span>
            </div>
            <Switch
              checked={automaticTaxes}
              onCheckedChange={setAutomaticTaxes}
              className="data-[state=unchecked]:border-slate-400 data-[state=unchecked]:bg-slate-200"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <Label>세금 포함 가격</Label>
              <span className="text-xs text-muted-foreground">
                이 통화의 가격이 세금을 포함하는지 여부입니다.
              </span>
            </div>
            <Switch
              checked={taxInclusive}
              onCheckedChange={setTaxInclusive}
              className="data-[state=unchecked]:border-slate-400 data-[state=unchecked]:bg-slate-200"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '처리 중...' : isEdit ? '저장' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
