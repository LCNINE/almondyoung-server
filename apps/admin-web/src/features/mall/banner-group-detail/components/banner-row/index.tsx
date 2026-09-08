'use client';

import { ChevronDown, ChevronUp, Image as ImageIcon, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import type { BannerDto } from '@/lib/types/dto/products';

export type BannerDraft = {
  title?: string;
  linkUrl?: string;
  isActive?: boolean;
  displayStartAt?: string;
  displayEndAt?: string;
};

type Props = {
  banner: BannerDto;
  draft: BannerDraft;
  index: number;
  total: number;
  isHero: boolean;
  onChange: (patch: BannerDraft) => void;
  onEditImages: () => void;
  onEditList: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onMove: (direction: -1 | 1) => void;
  isMoving: boolean;
  /** 방금 이 배너를 옮겼다 — 새 자리에서 잠깐 강조해 «어디로 갔는지» 보여준다 */
  justMoved: boolean;
};

/** 시안(Figma 10:40829 / cafe24 배너 매니저) 규격 */
const THUMB_SIZE = 210;
const INPUT_CLASS = 'h-10 rounded-[6px] border-[#e4e4e7] bg-white text-[13px] shadow-none';

export function BannerRow({
  banner,
  draft,
  index,
  total,
  isHero,
  onChange,
  onEditImages,
  onEditList,
  onDelete,
  onPreview,
  onMove,
  isMoving,
  justMoved,
}: Props) {
  const pcSrc = resolvePublicFileUrl(banner.pcImageFileId);
  const listSrc = resolvePublicFileUrl(banner.listImageFileId);
  const isActive = draft.isActive ?? banner.isActive;
  const alwaysOn = !draft.displayStartAt && !draft.displayEndAt;

  return (
    <div
      className={`flex items-start gap-6 border-b border-[#f0f0f2] px-6 py-6 last:border-b-0 ${
        isMoving ? 'opacity-60' : ''
      }`}
      style={{
        // 방금 옮긴 행에 잠깐 색을 얹어 «어디로 갔는지» 보여준다.
        // 순서 이동은 서버 왕복 뒤 목록이 다시 그려지는 거라, 표시가 없으면
        // 눌렀는데 아무 일도 안 일어난 것처럼 보인다.
        backgroundColor: justMoved ? '#fff2df' : '#ffffff',
        transition: 'background-color 600ms ease',
      }}
    >
      {/* 순서 */}
      <div className="flex w-[76px] shrink-0 justify-center pt-16">
        <div className="flex flex-col items-center rounded-[6px] border border-[#e4e4e7] px-3 py-1.5">
          <button
            type="button"
            aria-label="위로 이동"
            disabled={index === 0 || isMoving}
            onClick={() => onMove(-1)}
            className="text-muted-foreground hover:text-foreground disabled:opacity-25"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <span className="text-sm text-[#1f2937]">{index + 1}</span>
          <button
            type="button"
            aria-label="아래로 이동"
            disabled={index === total - 1 || isMoving}
            onClick={() => onMove(1)}
            className="text-muted-foreground hover:text-foreground disabled:opacity-25"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 이미지 — 정사각 카드 안에 배너를 세로 중앙 정렬 */}
      <div className="shrink-0">
        <div
          className="relative overflow-hidden rounded-[4px] border border-[#e4e4e7] bg-white"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        >
          {pcSrc ? (
            // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pcSrc}
              alt=""
              className={`h-full w-full object-contain ${isActive ? '' : 'opacity-35 grayscale'}`}
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1 text-xs">
              <ImageIcon className="h-6 w-6" />
              이미지 없음
            </div>
          )}
          {/*
            상태 배지는 «누를 것»이 아니라 표시라 주황(#f29219)을 쓰지 않는다 —
            그 색은 저장·노출하기 같은 행동에만 남겨둔다. 노출/숨김 구분은 색이 아니라
            글자 무게와 이미지 흐림이 이미 하고 있어서, 배지는 시안의 중립 태그
            (bg #f4f4f5 · border #e4e4e7 · text #52525b) 그대로 둔다.
          */}
          <Badge
            variant="secondary"
            className={`absolute top-2 left-2 border-[#e4e4e7] bg-white/95 text-[11px] ${
              isActive ? 'text-[#18181b]' : 'text-[#52525b]'
            }`}
          >
            {isActive ? '노출중' : '숨김'}
          </Badge>
          <div className="absolute bottom-2 left-2 flex gap-1">
            <button
              type="button"
              onClick={onEditImages}
              className="rounded-[4px] bg-[#2f6fed] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2559c4]"
            >
              변경
            </button>
            <button
              type="button"
              onClick={() => onChange({ isActive: !isActive })}
              className={`rounded-[4px] px-3 py-1.5 text-xs font-medium text-white ${
                isActive ? 'bg-[#9ca3af] hover:bg-[#6b7280]' : 'bg-[#f29219] hover:bg-[#df7b00]'
              }`}
            >
              {isActive ? '미사용으로' : '노출하기'}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onPreview}
          className="text-muted-foreground hover:text-foreground mt-2 w-full text-center text-xs underline"
        >
          화면 미리보기
        </button>
      </div>

      {/* 배너 정보 */}
      <div className="grid min-w-0 flex-1 gap-3">
        <Field label="배너 이름">
          <Input
            value={draft.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="관리용 이름"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="링크 URL">
          <Input
            value={draft.linkUrl ?? ''}
            onChange={(e) => onChange({ linkUrl: e.target.value || undefined })}
            placeholder="이동될 URL을 입력하세요"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="표시 기간">
          <div className="flex flex-wrap items-center gap-4">
            <Radio
              checked={alwaysOn}
              onSelect={() => onChange({ displayStartAt: undefined, displayEndAt: undefined })}
              label="항상 표시"
            />
            <Radio
              checked={!alwaysOn}
              onSelect={() =>
                onChange({
                  displayStartAt: draft.displayStartAt ?? toLocalInput(new Date()),
                })
              }
              label="기간 설정"
            />
            {!alwaysOn && (
              <div className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={toLocalInput(draft.displayStartAt)}
                  onChange={(e) => onChange({ displayStartAt: e.target.value || undefined })}
                  className={`${INPUT_CLASS} w-[200px]`}
                />
                <span className="text-muted-foreground text-xs">~</span>
                <Input
                  type="datetime-local"
                  value={toLocalInput(draft.displayEndAt)}
                  onChange={(e) => onChange({ displayEndAt: e.target.value || undefined })}
                  className={`${INPUT_CLASS} w-[200px]`}
                />
              </div>
            )}
          </div>
        </Field>

        {isHero && (
          <Field label="리스트">
            {/*
              리스트는 그림과 문구가 «칸 안에서 같이» 보여야 판단이 되는 값이라,
              여기서는 지금 상태만 보여주고 고치는 건 전용 다이얼로그로 넘긴다.
            */}
            <button
              type="button"
              onClick={onEditList}
              className="flex h-10 w-full items-center gap-2 rounded-[6px] border border-[#e4e4e7] bg-white px-2 text-left hover:border-[#c6c6c6]"
            >
              {listSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={listSrc} alt="" className="h-7 w-7 shrink-0 object-contain" />
              ) : (
                <span className="bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px]">
                  <ImageIcon className="text-muted-foreground h-3.5 w-3.5" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {banner.listLabel || (
                  <span className="text-muted-foreground">
                    비어 있음 — 눌러서 그림과 문구를 넣으세요
                  </span>
                )}
              </span>
              <Pencil className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            </button>
          </Field>
        )}
      </div>

      <div className="w-[100px] shrink-0 pt-16 text-center">
        <Button
          variant="outline"
          onClick={onDelete}
          className="h-10 rounded-full border-[#e4e4e7] bg-white px-6 text-sm"
        >
          삭제
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-4">
      <span className="text-[14px] font-medium text-[#374151]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button type="button" onClick={onSelect} className="flex items-center gap-1.5">
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
          checked ? 'border-[#2f6fed]' : 'border-[#c6c6c6]'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#2f6fed]" />}
      </span>
      <span className="text-[13px] text-[#1f2937]">{label}</span>
    </button>
  );
}

/** ISO 문자열을 datetime-local 이 받는 `YYYY-MM-DDTHH:mm` 로 자른다 */
function toLocalInput(v?: string | Date) {
  if (!v) return '';
  const d = typeof v === 'string' ? v : v.toISOString();
  return d.slice(0, 16);
}
