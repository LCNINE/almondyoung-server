'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useBannerGroups, useUpdateBannerGroup } from '@/lib/services/products';
import type { BannerGroupDto, UpdateBannerGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { formatRatio } from '../../banner-image-guide';
import {
  BANNER_GROUP_PRESETS,
  MOBILE_VIEWPORT,
  PC_VIEWPORT,
  matchPreset,
  renderedHeight,
} from '../../../banner-groups/banner-group-presets';
import { BannerSection, FieldLabel } from '../section';

type Props = {
  group: BannerGroupDto;
};

/** 칩으로 한 줄에 무리 없이 들어가는 개수. 넘으면 접는다 */
const CATEGORY_CHIP_LIMIT = 6;

/** 시안의 입력칸 — h32, radius 6, bg #f4f4f5 */
const INPUT_CLASS =
  'h-8 rounded-[6px] border-[#e4e4e7] bg-[#f4f4f5] text-[13px] shadow-none';

export function GroupForm({ group }: Props) {
  const [form, setForm] = useState<UpdateBannerGroupDto>({});
  const updateMutation = useUpdateBannerGroup();
  /**
   * 카테고리는 자유 입력이라 «MAIN / main / 메인» 처럼 조금만 달라도 목록 탭이
   * 갈라진다. 이미 쓰이는 값을 자동완성으로 띄워 같은 값을 다시 치게 유도한다.
   */
  const { data: groups = [] } = useBannerGroups();
  const usedCategories = [...new Set(groups.map((g) => g.category))].filter(
    (c): c is string => !!c,
  );
  const [showAllCategories, setShowAllCategories] = useState(false);

  useEffect(() => {
    setForm({
      title: group.title,
      category: group.category ?? undefined,
      description: group.description ?? undefined,
      pcWidth: group.pcWidth ?? undefined,
      pcHeight: group.pcHeight ?? undefined,
      mobileWidth: group.mobileWidth ?? undefined,
      mobileHeight: group.mobileHeight ?? undefined,
      sortOrder: group.sortOrder ?? undefined,
      isActive: group.isActive,
    });
  }, [group]);

  const set =
    (key: keyof UpdateBannerGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const setNum =
    (key: keyof UpdateBannerGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({
        ...prev,
        [key]: e.target.value ? Number(e.target.value) : undefined,
      }));

  const handleSave = async () => {
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: group.id, dto: form });
      toast.success('배너 그룹이 수정되었습니다.');
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  /*
    카테고리가 늘면 칩이 폼을 세로로 밀어낸다. 한 줄에 들어갈 만큼만 보이고 나머지는
    접는다 — 선택된 값은 접혀 있어도 항상 보이게 앞으로 끌어온다.
  */
  const orderedCategories = form.category
    ? [form.category, ...usedCategories.filter((c) => c !== form.category)]
    : usedCategories;
  const visibleCategories = showAllCategories
    ? orderedCategories
    : orderedCategories.slice(0, CATEGORY_CHIP_LIMIT);
  const hiddenCount = orderedCategories.length - visibleCategories.length;

  const preset = matchPreset(form);

  return (
    <BannerSection
      title="배너 그룹 정보"
      action={
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <label htmlFor="isActive" className="text-sm text-[#1f2937]">
              {form.isActive ?? true ? '노출중' : '숨김'}
            </label>
          </div>
          <Button
            size="sm"
            className="bg-[#f29219] hover:bg-[#df7b00]"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            저장
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-x-12 gap-y-4 xl:grid-cols-2">
        {/* 좌: 코드 · 제목 · 설명 */}
        <div className="grid gap-4">
          <div className="grid grid-cols-[124px_1fr] items-center gap-4">
            <FieldLabel>배너 그룹 코드</FieldLabel>
            <Input value={group.code} readOnly className={`${INPUT_CLASS} text-muted-foreground`} />
          </div>
          <div className="grid grid-cols-[124px_1fr] items-center gap-4">
            <FieldLabel htmlFor="title" required>
              배너 그룹 제목
            </FieldLabel>
            <Input
              id="title"
              value={form.title ?? ''}
              onChange={set('title')}
              className={INPUT_CLASS}
            />
          </div>
          <div className="grid grid-cols-[124px_1fr] items-center gap-4">
            <FieldLabel htmlFor="description">배너 그룹 설명</FieldLabel>
            <Input
              id="description"
              value={form.description ?? ''}
              onChange={set('description')}
              className={INPUT_CLASS}
            />
          </div>
          <div className="grid grid-cols-[124px_1fr] items-start gap-4">
            <FieldLabel htmlFor="category">카테고리</FieldLabel>
            <div>
              <Input
                id="category"
                list="banner-group-categories"
                value={form.category ?? ''}
                onChange={set('category')}
                placeholder="아래에서 고르거나 새 이름을 입력"
                className={INPUT_CLASS}
              />
              <datalist id="banner-group-categories">
                {usedCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {usedCategories.length > 0 && (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {visibleCategories.map((c) => {
                      const selected = form.category === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              category: selected ? undefined : c,
                            }))
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected
                              ? 'border-[#007aff] bg-[#007aff]/10 font-medium text-[#007aff]'
                              : 'border-[#e4e4e7] bg-white text-[#52525b] hover:border-[#c6c6c6]'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllCategories(true)}
                        className="text-muted-foreground hover:text-foreground rounded-full border border-dashed border-[#c6c6c6] px-2.5 py-1 text-xs"
                      >
                        +{hiddenCount}개 더
                      </button>
                    )}
                    {showAllCategories && usedCategories.length > CATEGORY_CHIP_LIMIT && (
                      <button
                        type="button"
                        onClick={() => setShowAllCategories(false)}
                        className="text-muted-foreground hover:text-foreground px-1 text-xs underline underline-offset-2"
                      >
                        접기
                      </button>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    같은 값끼리 목록에서 한 탭으로 묶입니다. 위 칸에 새 이름을 적으면
                    탭이 늘어납니다.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 우: 배너 사이즈 (모바일 / PC) */}
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-[100px_56px_1fr] items-center gap-x-3 gap-y-4">
            <FieldLabel>배너 사이즈</FieldLabel>
            <FieldLabel>모바일</FieldLabel>
            <RatioInputs
              width={form.mobileWidth}
              height={form.mobileHeight}
              onWidth={setNum('mobileWidth')}
              onHeight={setNum('mobileHeight')}
              viewport={MOBILE_VIEWPORT}
            />
            <span />
            <FieldLabel>PC</FieldLabel>
            <RatioInputs
              width={form.pcWidth}
              height={form.pcHeight}
              onWidth={setNum('pcWidth')}
              onHeight={setNum('pcHeight')}
              viewport={PC_VIEWPORT}
            />
          </div>

          <div className="grid grid-cols-[100px_1fr] items-start gap-x-3">
            <FieldLabel>규격 프리셋</FieldLabel>
            <div>
              <div className="flex flex-wrap gap-2">
                {BANNER_GROUP_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant={preset?.label === p.label ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 text-xs ${preset?.label === p.label ? '' : 'bg-white'}`}
                    title={p.hint}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        pcWidth: p.pcWidth,
                        pcHeight: p.pcHeight,
                        mobileWidth: p.mobileWidth,
                        mobileHeight: p.mobileHeight,
                      }))
                    }
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                숫자는 픽셀이 아니라 <strong className="font-medium">비율</strong>입니다.
                규격을 바꾸면 기존 이미지가 새 비율로 잘리니, 저장한 뒤 아래 배너를
                미리보기로 확인하세요.
              </p>
            </div>
          </div>
        </div>
      </div>
    </BannerSection>
  );
}

/** 너비 × 높이 + 실제 렌더 높이 안내 */
function RatioInputs({
  width,
  height,
  onWidth,
  onHeight,
  viewport,
}: {
  width?: number;
  height?: number;
  onWidth: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onHeight: (e: React.ChangeEvent<HTMLInputElement>) => void;
  viewport: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        placeholder="너비"
        value={width ?? ''}
        onChange={onWidth}
        className={`${INPUT_CLASS} w-24`}
      />
      <span className="text-muted-foreground text-xs">×</span>
      <Input
        type="number"
        placeholder="높이"
        value={height ?? ''}
        onChange={onHeight}
        className={`${INPUT_CLASS} w-24`}
      />
      {width && height ? (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {formatRatio(width, height)} → {viewport}px 화면에서{' '}
          {renderedHeight(width, height, viewport)}px
        </span>
      ) : null}
    </div>
  );
}
