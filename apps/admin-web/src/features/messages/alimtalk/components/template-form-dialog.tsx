'use client';

import { Loader, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  AlimtalkCategory,
  AlimtalkTemplate,
} from '@/lib/api/domains/alimtalk';
import {
  useAlimtalkCategories,
  useCreateAlimtalkTemplate,
  useUpdateAlimtalkTemplate,
} from '@/lib/services/alimtalk';
import {
  extractVariables,
  LIMITS,
  TemplateFormValues,
  validateTemplateForm,
} from '../lib/alimtalk';
import { KakaoBubble } from './kakao-bubble';

const EMPTY: TemplateFormValues = {
  templateCode: '',
  templateName: '',
  templateContent: '',
  categoryCode: '',
  buttons: [],
};

const errorMessage = (error: unknown, fallback: string) =>
  (error instanceof Error && error.message) || fallback;

export function AlimtalkTemplateFormDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 없으면 새로 만들기 */
  template?: AlimtalkTemplate | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {template ? '알림톡 템플릿 수정 요청' : '알림톡 템플릿 만들기'}
          </DialogTitle>
        </DialogHeader>
        <FormBody
          key={template?.templateCode ?? 'create'}
          template={template ?? null}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormBody({
  template,
  onClose,
}: {
  template: AlimtalkTemplate | null;
  onClose: () => void;
}) {
  const isCreate = template === null;
  const [form, setForm] = useState<TemplateFormValues>(() =>
    template
      ? {
          templateCode: template.templateCode,
          templateName: template.templateName,
          templateContent: template.templateContent,
          categoryCode: template.categoryCode ?? '',
          buttons: template.buttons
            .filter((b) => b.type === 'WL')
            .map((b) => ({
              name: b.name,
              linkMo: b.linkMo ?? '',
              ...(b.linkPc ? { linkPc: b.linkPc } : {}),
            })),
        }
      : EMPTY
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const categories = useAlimtalkCategories();
  const createTemplate = useCreateAlimtalkTemplate();
  const updateTemplate = useUpdateAlimtalkTemplate();
  const isSubmitting = createTemplate.isPending || updateTemplate.isPending;

  const activeEvents = template?.linkedEvents.filter((e) => e.isActive) ?? [];
  const nonWebButtons =
    template?.buttons.filter((b) => b.type !== 'WL').length ?? 0;
  const lockReason =
    template?.status === 'TSC02'
      ? '카카오가 검수 중이라 지금은 고칠 수 없습니다. 결과가 나온 뒤에 고치세요.'
      : activeEvents.length > 0
        ? `켜져 있는 알림(${activeEvents.map((e) => e.name).join(', ')})이 이 템플릿을 씁니다. 고치면 다시 승인될 때까지 그 알림이 나가지 않으니, 알림을 먼저 끄세요.`
        : nonWebButtons > 0
          ? '웹링크가 아닌 버튼이 있는 템플릿은 여기서 고칠 수 없습니다. NHN 콘솔에서 고치세요.'
          : null;
  const needsAck = template?.status === 'TSC03';
  const errors = validateTemplateForm(form, isCreate);
  const variables = extractVariables(form.templateContent, form.buttons);
  const groups = useMemo(
    () => groupCategories(categories.data ?? []),
    [categories.data]
  );
  const selectedCategory = categories.data?.find(
    (c) => c.code === form.categoryCode
  );

  const setButton = (
    index: number,
    patch: Partial<TemplateFormValues['buttons'][number]>
  ) =>
    setForm({
      ...form,
      buttons: form.buttons.map((b, i) =>
        i === index ? { ...b, ...patch } : b
      ),
    });

  const handleSubmit = () => {
    setShowErrors(true);
    if (errors.length > 0 || lockReason || (needsAck && !acknowledged)) return;
    const values = {
      templateName: form.templateName,
      templateContent: form.templateContent,
      categoryCode: form.categoryCode,
      buttons: form.buttons.map((b) => ({
        name: b.name,
        linkMo: b.linkMo,
        ...(b.linkPc?.trim() ? { linkPc: b.linkPc } : {}),
      })),
    };
    const callbacks = (done: string, failed: string) => ({
      onSuccess: () => {
        toast.success(done);
        onClose();
      },
      onError: (error: unknown) => toast.error(errorMessage(error, failed)),
    });
    if (isCreate) {
      createTemplate.mutate(
        { templateCode: form.templateCode, values },
        callbacks(
          '카카오에 심사를 요청했습니다. 보통 영업일 1~2일 걸립니다.',
          '템플릿을 등록하지 못했습니다.'
        )
      );
      return;
    }
    updateTemplate.mutate(
      {
        templateCode: form.templateCode,
        values: { ...values, acknowledgeReReview: needsAck ? true : undefined },
      },
      callbacks(
        '수정해서 다시 심사를 요청했습니다.',
        '템플릿을 고치지 못했습니다.'
      )
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_300px]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          알림톡은 <b>받는 분과의 거래·계약에 관한 정보</b>만 보낼 수
          있습니다(주문·결제·멤버십·약관 안내 등). 할인·이벤트 같은 광고 문구가
          조금이라도 들어가면 카카오 심사에서 반려됩니다.
        </p>
        {lockReason && <p className="text-destructive text-sm">{lockReason}</p>}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alimtalk-code">템플릿 코드</Label>
          <Input
            id="alimtalk-code"
            placeholder="예: MEMB_NOTICE_01"
            maxLength={LIMITS.code}
            value={form.templateCode}
            disabled={!isCreate}
            onChange={(e) =>
              setForm({ ...form, templateCode: e.target.value.trim() })
            }
          />
          <p className="text-muted-foreground text-xs">
            영문·숫자·밑줄 {LIMITS.code}자까지. 등록한 뒤에는 바꿀 수 없습니다.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alimtalk-name">템플릿 이름</Label>
          <Input
            id="alimtalk-name"
            placeholder="예: 멤버십 약관 변경 안내"
            maxLength={LIMITS.name}
            value={form.templateName}
            onChange={(e) => setForm({ ...form, templateName: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>카테고리</Label>
          <Select
            value={form.categoryCode}
            onValueChange={(categoryCode) => setForm({ ...form, categoryCode })}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  categories.isLoading
                    ? '불러오는 중...'
                    : '카테고리를 고르세요'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {groups.map(([group, items]) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {items.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {selectedCategory?.inclusion && (
            <p className="text-muted-foreground text-xs">
              이런 안내에 씁니다: {selectedCategory.inclusion}
            </p>
          )}
          {categories.isError && (
            <p className="text-destructive text-xs">
              카테고리를 불러오지 못했습니다.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alimtalk-content">본문</Label>
          <Textarea
            id="alimtalk-content"
            rows={10}
            value={form.templateContent}
            onChange={(e) =>
              setForm({ ...form, templateContent: e.target.value })
            }
            placeholder={'#{name}님, 안녕하세요.\n...'}
          />
          <div className="text-muted-foreground flex justify-between gap-2 text-xs">
            <span>
              받는 사람마다 바뀌는 자리는 <code>#&#123;name&#125;</code> 처럼
              씁니다.
              {variables.length > 0 &&
                ` 쓰인 변수: ${variables.map((v) => `#{${v}}`).join(', ')}`}
            </span>
            <span
              className={
                form.templateContent.length > LIMITS.content
                  ? 'text-destructive'
                  : ''
              }
            >
              {form.templateContent.length.toLocaleString()} /{' '}
              {LIMITS.content.toLocaleString()}자
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>버튼 (웹링크, {LIMITS.buttons}개까지)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={form.buttons.length >= LIMITS.buttons}
              onClick={() =>
                setForm({
                  ...form,
                  buttons: [...form.buttons, { name: '', linkMo: '' }],
                })
              }
            >
              <Plus className="size-4" />
              버튼 추가
            </Button>
          </div>
          {form.buttons.map((button, i) => (
            <div
              key={i}
              className="flex flex-col gap-1.5 rounded-md border p-2 sm:flex-row sm:items-center"
            >
              <Input
                aria-label={`버튼 ${i + 1} 이름`}
                className="sm:w-40"
                placeholder="버튼 이름"
                maxLength={LIMITS.buttonName}
                value={button.name}
                onChange={(e) => setButton(i, { name: e.target.value })}
              />
              <Input
                aria-label={`버튼 ${i + 1} 링크`}
                placeholder="https://..."
                maxLength={LIMITS.link}
                value={button.linkMo}
                onChange={(e) => setButton(i, { linkMo: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`버튼 ${i + 1} 빼기`}
                onClick={() =>
                  setForm({
                    ...form,
                    buttons: form.buttons.filter((_, j) => j !== i),
                  })
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {needsAck && !lockReason && (
          <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              className="mt-0.5"
            />
            <span>
              승인된 템플릿입니다. 고치면 카카오 심사를 처음부터 다시 받고,{' '}
              <b>다시 승인될 때까지 이 템플릿으로 보낼 수 없습니다.</b>
            </span>
          </label>
        )}

        {showErrors && errors.length > 0 && (
          <ul className="text-destructive list-disc pl-5 text-xs">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            type="submit"
            disabled={
              isSubmitting || lockReason !== null || (needsAck && !acknowledged)
            }
          >
            {isSubmitting ? (
              <Loader className="animate-spin" />
            ) : isCreate ? (
              '심사 요청'
            ) : (
              '수정해서 다시 심사 요청'
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>미리보기</Label>
        <KakaoBubble body={form.templateContent} buttons={form.buttons} />
        <p className="text-muted-foreground text-xs">
          알림톡을 못 받는 분(카카오톡 미사용·차단)에게는 같은 내용이 문자로
          대신 갑니다. 90byte 를 넘으면 장문 문자 요금이 듭니다.
        </p>
      </div>
    </form>
  );
}

function groupCategories(
  categories: AlimtalkCategory[]
): [string, AlimtalkCategory[]][] {
  const map = new Map<string, AlimtalkCategory[]>();
  for (const c of categories)
    map.set(c.groupName || '기타', [
      ...(map.get(c.groupName || '기타') ?? []),
      c,
    ]);
  return [...map.entries()];
}
