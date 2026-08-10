'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RichTextEditor } from '@/components/common/rich-text-editor';
import { ImageUploadField } from '@/components/common/image-upload-field';
import { SITE_POPUP_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useNotices } from '@/lib/services/products';
import {
  AUDIENCE_LABEL,
  CONTENT_TYPE_LABEL,
  DEFAULT_MOBILE_WIDTH,
  DEFAULT_PC_WIDTH,
  DISMISS_MODE_LABEL,
  PLACEMENT_LABEL,
  type SitePopupFormValue,
} from '../../form';
import {
  SITE_POPUP_AUDIENCES,
  SITE_POPUP_CONTENT_TYPES,
  SITE_POPUP_DISMISS_MODES,
  SITE_POPUP_PLACEMENTS,
} from '@/lib/types/dto/products';

type Props = {
  value: SitePopupFormValue;
  onChange: (next: SitePopupFormValue) => void;
};

const NONE_VALUE = '__none__';
const switchClassName = 'h-6 w-11 border border-border data-[state=unchecked]:bg-muted';

export function PopupFormFields({ value, onChange }: Props) {
  const { data: notices } = useNotices({ includeInactive: true });

  const set = <K extends keyof SitePopupFormValue>(key: K, next: SitePopupFormValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="popup-title">
          제목 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="popup-title"
          className="h-11"
          placeholder="예: 회원가입 리뉴얼 안내"
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          팝업 상단에 표시되고, 목록에서 팝업을 구분하는 이름이기도 합니다.
        </p>
      </div>

      <div className="grid gap-2">
        <Label>내용 형식</Label>
        <Select
          value={value.contentType}
          onValueChange={(v) => set('contentType', v as SitePopupFormValue['contentType'])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SITE_POPUP_CONTENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {CONTENT_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.contentType === 'rich_text' ? (
        <div className="grid gap-2">
          <Label>
            본문 <span className="text-destructive">*</span>
          </Label>
          <RichTextEditor
            value={value.content}
            onChange={(html) => set('content', html)}
            imageContextId={SITE_POPUP_IMAGE_CONTEXT_ID}
            placeholder="팝업에 띄울 내용을 입력하세요."
          />
        </div>
      ) : (
        <div className="grid gap-4 rounded-md border p-4">
          <ImageUploadField
            label="PC 이미지"
            required
            previewShape="wide"
            contextId={SITE_POPUP_IMAGE_CONTEXT_ID}
            value={value.pcImageFileId}
            onChange={(fileId) => set('pcImageFileId', fileId)}
          />
          <ImageUploadField
            label="모바일 이미지"
            previewShape="wide"
            description="비워두면 PC 이미지를 모바일에서도 사용합니다."
            contextId={SITE_POPUP_IMAGE_CONTEXT_ID}
            value={value.mobileImageFileId}
            onChange={(fileId) => set('mobileImageFileId', fileId)}
          />
          <div className="grid gap-2">
            <Label htmlFor="popup-image-alt">이미지 설명 (대체 텍스트)</Label>
            <Input
              id="popup-image-alt"
              placeholder="화면 낭독기와 이미지 로딩 실패 시 사용됩니다."
              value={value.imageAlt}
              onChange={(e) => set('imageAlt', e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="bg-muted/20 grid gap-4 rounded-md border p-4">
        <h3 className="text-sm font-medium">크기</h3>
        <p className="text-muted-foreground text-xs">
          높이를 비워두면 내용 길이(이미지는 원본 비율)에 맞춰 자동으로 정해집니다. 지정한 너비가
          방문자 화면보다 넓으면 화면 안에 들어오도록 자동으로 줄어듭니다.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="popup-pc-width">PC 너비 (px)</Label>
            <Input
              id="popup-pc-width"
              type="number"
              placeholder={String(DEFAULT_PC_WIDTH)}
              value={value.pcWidth}
              onChange={(e) => set('pcWidth', e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="popup-pc-height">PC 높이 (px)</Label>
            <Input
              id="popup-pc-height"
              type="number"
              placeholder="자동"
              value={value.pcHeight}
              onChange={(e) => set('pcHeight', e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="popup-mobile-width">모바일 너비 (px)</Label>
            <Input
              id="popup-mobile-width"
              type="number"
              placeholder={String(DEFAULT_MOBILE_WIDTH)}
              value={value.mobileWidth}
              onChange={(e) => set('mobileWidth', e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="popup-mobile-height">모바일 높이 (px)</Label>
            <Input
              id="popup-mobile-height"
              type="number"
              placeholder="자동"
              value={value.mobileHeight}
              onChange={(e) => set('mobileHeight', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-muted/20 grid gap-4 rounded-md border p-4">
        <h3 className="text-sm font-medium">노출 설정</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>노출 위치</Label>
            <Select
              value={value.placement}
              onValueChange={(v) => set('placement', v as SitePopupFormValue['placement'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_POPUP_PLACEMENTS.map((placement) => (
                  <SelectItem key={placement} value={placement}>
                    {PLACEMENT_LABEL[placement]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>노출 대상</Label>
            <Select
              value={value.audience}
              onValueChange={(v) => set('audience', v as SitePopupFormValue['audience'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_POPUP_AUDIENCES.map((audience) => (
                  <SelectItem key={audience} value={audience}>
                    {AUDIENCE_LABEL[audience]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          결제·로그인 화면에는 어떤 설정이든 팝업이 뜨지 않습니다 — 결제 도중 모달이 뜨면 이탈로
          이어집니다.
        </p>

        {value.placement === 'paths' && (
          <div className="grid gap-2">
            <Label htmlFor="popup-paths">
              노출 경로 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="popup-paths"
              rows={3}
              placeholder={'/products\n/cs'}
              value={value.placementPathsText}
              onChange={(e) => set('placementPathsText', e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              한 줄에 하나씩. 해당 경로로 시작하는 모든 페이지에 노출됩니다. (국가 코드는 빼고 입력)
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>다시 보지 않기</Label>
            <Select
              value={value.dismissMode}
              onValueChange={(v) => set('dismissMode', v as SitePopupFormValue['dismissMode'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_POPUP_DISMISS_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {DISMISS_MODE_LABEL[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {value.dismissMode === 'days' && (
            <div className="grid gap-2">
              <Label htmlFor="popup-dismiss-days">
                숨김 일수 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="popup-dismiss-days"
                type="number"
                min={1}
                placeholder="7"
                value={value.dismissDays}
                onChange={(e) => set('dismissDays', e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-background flex items-center justify-between gap-4 rounded-md border px-3 py-3">
            <Label htmlFor="popup-active" className="cursor-pointer">
              노출 사용
            </Label>
            <Switch
              id="popup-active"
              className={switchClassName}
              checked={value.isActive}
              onCheckedChange={(checked) => set('isActive', checked)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="popup-sort">노출 순서 (낮을수록 먼저)</Label>
            <Input
              id="popup-sort"
              type="number"
              value={value.sortOrder}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-muted/20 grid gap-4 rounded-md border p-4">
        <h3 className="text-sm font-medium">연결</h3>
        <div className="grid gap-2">
          <Label htmlFor="popup-link">클릭 시 이동할 링크</Label>
          <Input
            id="popup-link"
            placeholder="https://... 또는 /products"
            value={value.linkUrl}
            onChange={(e) => set('linkUrl', e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label>연결할 공지사항 (자세히 보기)</Label>
          <Select
            value={value.noticeId ?? NONE_VALUE}
            onValueChange={(v) => set('noticeId', v === NONE_VALUE ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="없음" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>없음</SelectItem>
              {(notices ?? []).map((notice) => (
                <SelectItem key={notice.id} value={notice.id}>
                  {notice.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            선택하면 팝업에 &quot;자세히 보기&quot; 버튼이 생겨 고객센터의 해당 공지로 이동합니다.
          </p>
        </div>
      </div>

      <div className="bg-muted/20 grid gap-4 rounded-md border p-4">
        <h3 className="text-sm font-medium">게시 기간</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="popup-start">게시 시작</Label>
            <Input
              id="popup-start"
              type="datetime-local"
              value={value.displayStartAt}
              onChange={(e) => set('displayStartAt', e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="popup-end">게시 종료</Label>
            <Input
              id="popup-end"
              type="datetime-local"
              value={value.displayEndAt}
              onChange={(e) => set('displayEndAt', e.target.value)}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">비워두면 계속 노출됩니다.</p>
      </div>
    </div>
  );
}
