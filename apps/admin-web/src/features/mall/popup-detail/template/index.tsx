'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  useResetSitePopupDismissals,
  useSitePopup,
  useUpdateSitePopup,
} from '@/lib/services/products';
import { PopupFormFields } from '@/features/mall/popups/components/popup-form-fields';
import { PopupPreview } from '@/features/mall/popups/components/popup-preview';
import {
  EMPTY_POPUP_FORM,
  popupFormFromDto,
  popupFormToUpdateDto,
  validatePopupForm,
  type SitePopupFormValue,
} from '@/features/mall/popups/form';

type Props = {
  id: string;
};

export default function PopupDetailTemplate({ id }: Props) {
  const router = useRouter();
  const { data: popup, isLoading } = useSitePopup(id);
  const updateMutation = useUpdateSitePopup();
  const resetMutation = useResetSitePopupDismissals();

  const [form, setForm] = useState<SitePopupFormValue>(EMPTY_POPUP_FORM);

  useEffect(() => {
    if (popup) setForm(popupFormFromDto(popup));
  }, [popup]);

  if (isLoading) {
    return (
      <Container>
        <div className="text-muted-foreground p-6 text-sm">불러오는 중...</div>
      </Container>
    );
  }

  if (!popup) {
    return (
      <Container>
        <div className="text-muted-foreground p-6 text-sm">팝업을 찾을 수 없습니다.</div>
      </Container>
    );
  }

  const handleSave = async () => {
    const error = validatePopupForm(form);
    if (error) {
      toast.error(error);
      return;
    }

    try {
      await updateMutation.mutateAsync({ id, dto: popupFormToUpdateDto(form) });
      toast.success('팝업이 수정되었습니다.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '수정에 실패했습니다.');
    }
  };

  const handleResetDismissals = async () => {
    try {
      await resetMutation.mutateAsync(id);
      toast.success('숨김이 초기화되었습니다. 이미 닫은 방문자에게도 다시 노출됩니다.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '초기화에 실패했습니다.');
    }
  };

  return (
    <Container>
      <Header title={popup.title} subtitle="팝업 내용과 노출 조건을 수정합니다." />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <PopupFormFields value={form} onChange={setForm} />

        <div className="grid gap-4 lg:sticky lg:top-4 lg:self-start">
          <PopupPreview value={form} />

          <div className="grid gap-2 rounded-md border p-4">
            <p className="text-sm font-medium">숨김 초기화</p>
            <p className="text-muted-foreground text-xs">
              &quot;다시 보지 않기&quot; 를 누른 방문자에게도 이 팝업을 다시 노출합니다. 내용을
              크게 바꿔 모두에게 다시 알려야 할 때 사용하세요.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetDismissals}
              disabled={resetMutation.isPending}
            >
              숨김 초기화
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t px-6 py-4">
        <Button
          variant="outline"
          onClick={() => router.push('/mall/popups')}
          disabled={updateMutation.isPending}
        >
          목록으로
        </Button>
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          저장
        </Button>
      </div>
    </Container>
  );
}
