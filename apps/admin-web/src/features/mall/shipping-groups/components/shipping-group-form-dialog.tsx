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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_AREA_TEMPLATE_CODE,
  DEFAULT_SHIPPING_GROUP_CODE,
  DEFAULT_SHIPPING_GROUP_DELIVERY,
  SHIPPING_FEE_TYPES,
  SHIPPING_FEE_TYPE_LABELS,
  SHIPPING_METHODS,
  type ShippingFeeType,
  type ShippingGroup,
} from '@/lib/api/domains/medusa/shipping-groups';
import {
  useCreateShippingGroup,
  useShippingAreaTemplates,
  useUpdateShippingGroup,
} from '@/lib/services/medusa-shipping-groups';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null 이면 생성, 값이 있으면 수정 */
  group: ShippingGroup | null;
}

/** 빈 문자열은 0 으로 본다. 정수가 아니거나 음수면 null. */
function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
  const parsed = Number(trimmed.replace(/,/g, ''));
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function ShippingGroupFormDialog({ open, onOpenChange, group }: Props) {
  const isEdit = !!group;
  const isDefaultGroup = group?.code === DEFAULT_SHIPPING_GROUP_CODE;
  const createMutation = useCreateShippingGroup();
  const updateMutation = useUpdateShippingGroup();
  const pending = createMutation.isPending || updateMutation.isPending;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [feeType, setFeeType] = useState<ShippingFeeType>('conditional_free');
  const [baseFeeText, setBaseFeeText] = useState('');
  const [freeThresholdText, setFreeThresholdText] = useState('');
  const [areaTemplateCode, setAreaTemplateCode] = useState(DEFAULT_AREA_TEMPLATE_CODE);
  const [deliveryMethod, setDeliveryMethod] = useState(DEFAULT_SHIPPING_GROUP_DELIVERY.method);
  const [deliveryArea, setDeliveryArea] = useState(DEFAULT_SHIPPING_GROUP_DELIVERY.area);
  const [leadTimeMinText, setLeadTimeMinText] = useState(String(DEFAULT_SHIPPING_GROUP_DELIVERY.leadTimeMinDays));
  const [leadTimeMaxText, setLeadTimeMaxText] = useState(String(DEFAULT_SHIPPING_GROUP_DELIVERY.leadTimeMaxDays));
  const [description, setDescription] = useState('');
  const [carrier, setCarrier] = useState('');

  const { data: areaTemplates } = useShippingAreaTemplates();
  const selectedTemplate = (areaTemplates ?? []).find((t) => t.code === areaTemplateCode);

  useEffect(() => {
    if (!open) return;
    setCode(group?.code ?? '');
    setName(group?.name ?? '');
    setFeeType(group?.policy.type ?? 'conditional_free');
    setBaseFeeText(group ? String(group.policy.baseFee) : '');
    setFreeThresholdText(group?.policy.freeThreshold ? String(group.policy.freeThreshold) : '');
    setAreaTemplateCode(group?.areaTemplateCode ?? DEFAULT_AREA_TEMPLATE_CODE);
    setDeliveryMethod(group?.delivery.method ?? DEFAULT_SHIPPING_GROUP_DELIVERY.method);
    setDeliveryArea(group?.delivery.area ?? DEFAULT_SHIPPING_GROUP_DELIVERY.area);
    setLeadTimeMinText(String(group?.delivery.leadTimeMinDays ?? DEFAULT_SHIPPING_GROUP_DELIVERY.leadTimeMinDays));
    setLeadTimeMaxText(String(group?.delivery.leadTimeMaxDays ?? DEFAULT_SHIPPING_GROUP_DELIVERY.leadTimeMaxDays));
    setDescription(group?.description ?? '');
    setCarrier(group?.delivery.carrier ?? '');
  }, [open, group]);

  const handleSubmit = async () => {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();

    if (!trimmedName) return toast.error('그룹 이름을 입력해 주세요.');
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(trimmedCode))
      return toast.error('그룹 코드는 영소문자·숫자·하이픈 50자 이내입니다 (예: meal).');

    const baseFee = parseAmount(baseFeeText);
    const freeThreshold = parseAmount(freeThresholdText);
    const leadTimeMinDays = parseAmount(leadTimeMinText);
    const leadTimeMaxDays = parseAmount(leadTimeMaxText);

    if (baseFee === null || freeThreshold === null)
      return toast.error('금액은 0 이상의 정수로 입력해 주세요.');
    if (leadTimeMinDays === null || leadTimeMaxDays === null)
      return toast.error('배송기간은 0 이상의 정수로 입력해 주세요.');
    if (leadTimeMinDays > leadTimeMaxDays)
      return toast.error('배송기간은 시작일이 종료일보다 클 수 없습니다.');
    if (feeType !== 'free' && baseFee <= 0)
      return toast.error("배송비를 받지 않으려면 유형을 '배송비 무료'로 선택해 주세요.");
    if (feeType === 'conditional_free' && freeThreshold <= 0)
      return toast.error('무료배송 기준 금액을 입력해 주세요.');

    const payload = {
      name: trimmedName,
      policy: { type: feeType, baseFee, freeThreshold },
      areaTemplateCode,
      delivery: {
        method: deliveryMethod,
        area: deliveryArea.trim() || DEFAULT_SHIPPING_GROUP_DELIVERY.area,
        leadTimeMinDays,
        leadTimeMaxDays,
        carrier: carrier.trim(),
      },
      description: description.trim(),
    };

    try {
      if (isEdit && group) {
        await updateMutation.mutateAsync({ code: group.code, payload });
        toast.success('배송비 그룹을 수정했어요.');
      } else {
        await createMutation.mutateAsync({ code: trimmedCode, ...payload });
        toast.success('배송비 그룹을 만들었어요.');
      }
      onOpenChange(false);
    } catch {
      toast.error(isEdit ? '배송비 그룹 수정에 실패했어요.' : '배송비 그룹 생성에 실패했어요.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? '배송비 그룹 수정' : '배송비 그룹 추가'}</DialogTitle>
          <DialogDescription>
            같은 그룹의 상품은 여러 개를 담아도 배송비가 한 번만 부과됩니다. 다른 그룹의 상품과 함께
            주문하면 그룹마다 배송비가 각각 붙습니다. 무료배송 기준은 그 그룹 상품들의 합계로 판정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="shipping-group-name">그룹 이름</Label>
              <Input
                id="shipping-group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="간편식 배송"
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="shipping-group-code">그룹 코드</Label>
              <Input
                id="shipping-group-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="meal"
                disabled={pending || isEdit}
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  코드는 상품이 참조하는 값이라 바꿀 수 없어요.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shipping-group-fee-type">배송비</Label>
            <Select
              value={feeType}
              onValueChange={(value) => setFeeType(value as ShippingFeeType)}
              disabled={pending}
            >
              <SelectTrigger id="shipping-group-fee-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPPING_FEE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {SHIPPING_FEE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {feeType !== 'free' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="shipping-group-base-fee">기본 배송비</Label>
                <Input
                  id="shipping-group-base-fee"
                  inputMode="numeric"
                  value={baseFeeText}
                  onChange={(event) => setBaseFeeText(event.target.value)}
                  placeholder="3000"
                  disabled={pending}
                />
                {feeType === 'per_quantity' && (
                  <p className="text-xs text-muted-foreground">상품 1개당 부과됩니다.</p>
                )}
              </div>
              {feeType === 'conditional_free' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="shipping-group-free-threshold">무료배송 기준 금액</Label>
                  <Input
                    id="shipping-group-free-threshold"
                    inputMode="numeric"
                    value={freeThresholdText}
                    onChange={(event) => setFreeThresholdText(event.target.value)}
                    placeholder="30000"
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    이 그룹 상품 합계(할인 전) 기준입니다.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="shipping-group-area-template">지역별 배송비 템플릿</Label>
            <Select
              value={areaTemplateCode}
              onValueChange={setAreaTemplateCode}
              disabled={pending}
            >
              <SelectTrigger id="shipping-group-area-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(areaTemplates ?? []).map((template) => (
                  <SelectItem key={template.code} value={template.code}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedTemplate
                ? `제주 ${selectedTemplate.jejuExtraFee.toLocaleString('ko-KR')}원 · 도서산간 ${selectedTemplate.islandExtraFee.toLocaleString('ko-KR')}원 — 배송비가 무료로 떨어져도 별도 부과됩니다.`
                : '템플릿 금액은 지역별 배송비 템플릿 화면에서 수정합니다.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="shipping-group-delivery-method">배송방법</Label>
              <Select value={deliveryMethod} onValueChange={setDeliveryMethod} disabled={pending}>
                <SelectTrigger id="shipping-group-delivery-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="shipping-group-delivery-area">배송지역</Label>
              <Input
                id="shipping-group-delivery-area"
                value={deliveryArea}
                onChange={(event) => setDeliveryArea(event.target.value)}
                placeholder="전국지역"
                disabled={pending}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shipping-group-carrier">택배사 (선택)</Label>
            <Input
              id="shipping-group-carrier"
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              placeholder="한진택배"
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              상품 상세 배송 안내에 표시됩니다. 비워두면 기본 문구가 나옵니다.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shipping-group-lead-min">배송기간</Label>
            <div className="flex items-center gap-2">
              <Input
                id="shipping-group-lead-min"
                inputMode="numeric"
                className="w-20"
                value={leadTimeMinText}
                onChange={(event) => setLeadTimeMinText(event.target.value)}
                disabled={pending}
              />
              <span className="text-sm text-muted-foreground">일 ~</span>
              <Input
                id="shipping-group-lead-max"
                inputMode="numeric"
                className="w-20"
                value={leadTimeMaxText}
                onChange={(event) => setLeadTimeMaxText(event.target.value)}
                disabled={pending}
              />
              <span className="text-sm text-muted-foreground">일</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shipping-group-description">고객 안내 문구 (선택)</Label>
            <Textarea
              id="shipping-group-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="다른 출고지에서 개별 배송되는 상품이라 기본 배송과 분리되어 배송비가 별도로 부과됩니다."
              maxLength={500}
              rows={3}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              스토어프론트의 개별 배송비 안내 옆 (?) 아이콘에 표시됩니다. 비워두면 아이콘이 나오지
              않습니다.
            </p>
          </div>

          {isDefaultGroup && (
            <p className="text-xs text-muted-foreground">
              기본 그룹입니다. 배송비 그룹을 따로 지정하지 않은 모든 상품에 적용됩니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {isEdit ? '수정' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
