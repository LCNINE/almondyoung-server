'use client';

import { FormSelect } from '@/components/common/form';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_SHIPPING_GROUP_CODE,
  SHIPPING_FEE_TYPE_LABELS,
  type ShippingGroup,
} from '@/lib/api/domains/medusa/shipping-groups';
import Link from 'next/link';
import { useState } from 'react';

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

export function describeShippingGroupFee(group: ShippingGroup): string {
  const { policy } = group;
  switch (policy.type) {
    case 'free':
      return '배송비 무료';
    case 'flat':
      return won(policy.baseFee);
    case 'conditional_free':
      return `${won(policy.baseFee)} · ${won(policy.freeThreshold ?? 0)} 이상 무료`;
    case 'per_quantity':
      return `${won(policy.baseFee)} × 수량`;
    default:
      return '-';
  }
}

export function describeShippingGroupArea(group: ShippingGroup): string | null {
  const { jejuExtraFee, islandExtraFee } = group.policy;
  if (!jejuExtraFee && !islandExtraFee) return null;
  return `제주 ${won(jejuExtraFee ?? 0)} · 도서산간 ${won(islandExtraFee ?? 0)}`;
}

/**
 * 카페24 상품 등록의 `배송정보` 블록과 같은 배치.
 *
 * 다만 배송비 유형·금액은 상품이 아니라 배송비 그룹이 소유한다. 상품마다 금액을 따로 넣으면
 * 같은 그룹 상품 2개에 배송비가 2번 붙어(카페24 개별배송비 동작) "그룹당 1회" 규칙이 깨진다.
 * 배송방법·배송지역·배송기간은 배송비 계산과 무관한 안내 문구라 그룹 값을 그대로 보여준다.
 */
export function ShippingInfoBlock({
  value,
  onChange,
  groups,
  disabled,
  digital,
}: {
  /** 빈 문자열이면 기본 설정 사용 */
  value: string;
  onChange: (next: string) => void;
  groups: ShippingGroup[] | undefined;
  disabled?: boolean;
  digital?: boolean;
}) {
  // '개별설정' 라디오는 그 자체로 저장하지 않는다. 자동으로 아무 그룹이나 골라 저장하면
  // 라디오 한 번 잘못 눌러도 상품 배송비가 바뀌고 채널 재동기화까지 나간다.
  // 실제 저장은 아래 셀렉트에서 그룹을 고를 때만 일어난다.
  const [customMode, setCustomMode] = useState(false);
  const isCustom = customMode || Boolean(value);

  const customGroups = (groups ?? []).filter(
    (group) => group.code !== DEFAULT_SHIPPING_GROUP_CODE
  );
  const defaultGroup = (groups ?? []).find(
    (group) => group.code === DEFAULT_SHIPPING_GROUP_CODE
  );
  const selected = isCustom
    ? customGroups.find((group) => group.code === value)
    : defaultGroup;

  const options = isCustom
    ? customGroups.map((group) => ({ value: group.code, label: group.name }))
    : [
        {
          value: DEFAULT_SHIPPING_GROUP_CODE,
          label: defaultGroup ? `기본 설정 사용 (${defaultGroup.name})` : '기본 설정 사용',
        },
      ];

  if (digital) {
    return (
      <div className="flex flex-col gap-2">
        <Label>배송정보</Label>
        <p className="text-sm text-muted-foreground">
          디지털 상품은 배송이 없어 배송비가 부과되지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-4">
        <Label className="shrink-0">배송정보</Label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="product-shipping-mode"
            checked={!isCustom}
            onChange={() => {
              setCustomMode(false);
              if (value) onChange('');
            }}
            disabled={disabled}
          />
          기본설정 사용
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="product-shipping-mode"
            checked={isCustom}
            onChange={() => setCustomMode(true)}
            disabled={disabled || customGroups.length === 0}
          />
          개별설정
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="product-basic-shipping-group">배송비 그룹</Label>
        <FormSelect
          value={isCustom ? (value || undefined) : DEFAULT_SHIPPING_GROUP_CODE}
          onValueChange={(next) => onChange(next === DEFAULT_SHIPPING_GROUP_CODE ? '' : next)}
          options={options}
          placeholder="배송비 그룹 선택"
          disabled={disabled || !isCustom}
        />
        {isCustom && !value && (
          <p className="text-xs text-muted-foreground">
            그룹을 고르면 바로 적용됩니다.
          </p>
        )}
        {selected && (
          <div className="text-xs text-muted-foreground">
            <div>
              · {SHIPPING_FEE_TYPE_LABELS[selected.policy.type] ?? selected.policy.type} —{' '}
              {describeShippingGroupFee(selected)}
            </div>
            {describeShippingGroupArea(selected) && <div>· {describeShippingGroupArea(selected)}</div>}
          </div>
        )}
        <Link
          href="/mall/shipping-groups"
          className="w-fit text-xs text-primary underline underline-offset-2"
        >
          그룹 관리 바로가기 ▸
        </Link>
      </div>

      <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">배송방법</dt>
        <dd>{selected?.delivery.method ?? '-'}</dd>
        <dt className="text-muted-foreground">배송지역</dt>
        <dd>{selected?.delivery.area ?? '-'}</dd>
        <dt className="text-muted-foreground">배송기간</dt>
        <dd>
          {selected
            ? `${selected.delivery.leadTimeMinDays}일 ~ ${selected.delivery.leadTimeMaxDays}일`
            : '-'}
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        배송방법·배송지역·배송기간은 선택한 배송비 그룹의 값입니다. 다르게 쓰려면 그룹을 하나 더
        만들어 주세요.
      </p>
    </div>
  );
}
