'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useReplenishmentGrades,
  useUpdateReplenishmentGrades,
} from '@/lib/services/inventory';
import {
  DEMAND_GRADES,
  EMPTY_GRADE_FORM,
  REFLECTION_LABELS,
  gradeFormFrom,
  gradeItemsFrom,
  type GradeForm,
} from '../../../rules-model';
import { runWithToast } from '../../save-with-toast';

export function GradesTab() {
  const { data, isLoading } = useReplenishmentGrades();
  const update = useUpdateReplenishmentGrades();
  const [form, setForm] = useState<GradeForm>(EMPTY_GRADE_FORM);

  useEffect(() => {
    if (data) setForm(gradeFormFrom(data));
  }, [data]);

  if (isLoading || !data)
    return <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>;

  const handleSave = async () => {
    const { items, error } = gradeItemsFrom(form);
    if (items === null) {
      toast.error(error ?? '입력을 확인하세요.');
      return;
    }
    await runWithToast({
      run: () => update.mutateAsync(items),
      success: '등급별 α 를 저장했습니다.',
      failure: '저장에 실패했습니다.',
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">등급별 목표 예측 실패율 (α)</h3>
        <Badge variant="secondary">{REFLECTION_LABELS.immediate}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        α = 목표 예측 실패율(리드타임 안에 수요가 재주문점을 넘을 확률).
        작을수록 안전재고가 큽니다. 0 과 1 사이(배타)여야 합니다. 등급 자체는
        분류 창 누적 매출 컷으로 야간에 매겨집니다 — 컷을 바꾸는 것은 전역
        탭이고 다음 재계산에 반영됩니다.
      </p>
      <div className="grid max-w-md grid-cols-3 gap-3">
        {DEMAND_GRADES.map((grade) => (
          <label key={grade} className="flex flex-col gap-1 text-sm">
            <span>등급 {grade}</span>
            <Input
              value={form[grade]}
              onChange={(e) => setForm({ ...form, [grade]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={update.isPending}>
          {update.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}
