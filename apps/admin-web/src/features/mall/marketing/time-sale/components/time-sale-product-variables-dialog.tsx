'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { medusaTimeSaleSettingsApi } from '@/lib/api/domains/medusa/time-sales';
import { useTimeSaleProductRows } from '@/lib/services/time-sale';
import {
  MAX_VARIABLE_VALUE_LENGTH,
  defaultSaleDisplay,
  validateTimeSaleSettings,
  type TimeSaleSettings,
} from '@packages/domain-types/time-sale';
import { TimeSaleDialog } from './time-sale-dialog';
import { Input } from '@/components/ui/input';
import { saleToast } from './time-sale-workspace';

type Props = {
  sale: { saleId: string; title: string; productIds: string[] } | null;
  index: number;
  settings: TimeSaleSettings | undefined;
  revision: string;
  onClose: () => void;
};

// 목록 행의 말줄임표 버튼: 세일에 담긴 상품마다 사용자 변수 값을 입력해 설정에 저장한다.
export function TimeSaleProductVariablesDialog({
  sale,
  index,
  settings,
  revision,
  onClose,
}: Props) {
  const queryClient = useQueryClient();

  const { data: rows } = useTimeSaleProductRows(sale?.productIds ?? []);

  const [values, setValues] = useState<Record<string, Record<string, string>>>(
    {}
  );
  const [saving, setSaving] = useState(false);

  // 열 때마다 저장된 값으로 시작한다.
  useEffect(() => {
    if (!sale || !settings) return;

    setValues(
      structuredClone(settings.sales[sale.saleId]?.productVariables ?? {})
    );
  }, [sale, settings]);

  // 같은 상품의 variant 행이 여러 개여도 상품은 한 줄만 보인다.
  const products = [
    ...new Map((rows ?? []).map((r) => [r.productId, r.productTitle])),
  ];

  const variables = settings?.variables ?? [];

  const save = async () => {
    if (!sale || !settings) return;

    try {
      setSaving(true);

      const next = structuredClone(settings);
      const display = next.sales[sale.saleId] ?? defaultSaleDisplay();

      // 빈 값은 저장하지 않아 변수 preview 값으로 돌아가게 한다.
      display.productVariables = Object.fromEntries(
        Object.entries(values)
          .filter(([id]) => sale.productIds.includes(id))
          .map(([id, v]) => [
            id,
            Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')),
          ])
          .filter(([, v]) => Object.keys(v).length > 0)
      );
      next.sales[sale.saleId] = display;

      validateTimeSaleSettings(next);
      await medusaTimeSaleSettingsApi.save(next, revision);
      await queryClient.invalidateQueries({ queryKey: ['time-sale-settings'] });

      saleToast('사용자 정의 변수를 수정 하였습니다.');
      onClose();
    } catch (e) {
      saleToast(
        e instanceof Error ? e.message : '변수를 저장하지 못했습니다.',
        true
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <TimeSaleDialog
      open={!!sale}
      wide
      title={`타임세일 상품 사용자 변수 설정 [${index} : ${sale?.title ?? ''}]`}
      onClose={onClose}
      footer={
        <button
          className="ts-button ts-button-neutral"
          disabled={saving || variables.length === 0}
          onClick={() => void save()}
        >
          저장
        </button>
      }
    >
      <p className="ts-field-hint">값을 비우면 변수의 프리뷰 값이 보입니다.</p>
      {variables.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          정의된 사용자 변수가 없습니다. 사용자 정의 변수 메뉴에서 먼저
          추가하세요.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="ts-table">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="px-2 py-2 text-left">상품코드</th>
                <th className="px-2 py-2 text-left">상품명</th>
                {variables.map((v) => (
                  <th key={v.name} className="px-2 py-2 text-left">
                    {v.name} ({v.description})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(([productId, title]) => (
                <tr key={productId} className="border-t">
                  <td className="px-2 py-2">{productId}</td>
                  <td className="px-2 py-2">{title}</td>
                  {variables.map((v) => (
                    <td key={v.name} className="px-2 py-2">
                      <Input
                        aria-label={`${title} ${v.name}`}
                        maxLength={MAX_VARIABLE_VALUE_LENGTH}
                        value={values[productId]?.[v.name] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [productId]: {
                              ...prev[productId],
                              [v.name]: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TimeSaleDialog>
  );
}
