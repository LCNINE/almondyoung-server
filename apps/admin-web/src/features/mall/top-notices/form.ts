import {
  TOP_NOTICE_TEXT_MAX_LENGTH,
  type CreateTopNoticeDto,
  type TopNoticeDto,
  type UpdateTopNoticeDto,
} from '@/lib/types/dto/products';
import { isoToLocalInput, localInputToIso } from '@/lib/utils/datetime';

export type TopNoticeFormValue = {
  text: string;
  linkUrl: string;
  displayStartAt: string;
  displayEndAt: string;
  isActive: boolean;
  sortOrder: string;
};

export const EMPTY_TOP_NOTICE_FORM: TopNoticeFormValue = {
  text: '',
  linkUrl: '',
  displayStartAt: '',
  displayEndAt: '',
  isActive: true,
  sortOrder: '0',
};

export function topNoticeFormFromDto(dto: TopNoticeDto): TopNoticeFormValue {
  return {
    text: dto.text,
    linkUrl: dto.linkUrl ?? '',
    displayStartAt: isoToLocalInput(dto.displayStartAt),
    displayEndAt: isoToLocalInput(dto.displayEndAt),
    isActive: dto.isActive,
    sortOrder: String(dto.sortOrder ?? 0),
  };
}

/** 저장 전에 사람이 고칠 수 있는 문제를 잡는다. 통과하면 null. */
export function validateTopNoticeForm(value: TopNoticeFormValue): string | null {
  const text = value.text.trim();

  if (!text) return '문구를 입력해 주세요.';

  if (text.length > TOP_NOTICE_TEXT_MAX_LENGTH) {
    return `문구는 ${TOP_NOTICE_TEXT_MAX_LENGTH}자 이내로 입력해 주세요.`;
  }

  if (value.sortOrder.trim() && !Number.isInteger(Number(value.sortOrder))) {
    return '노출 순서는 정수로 입력해 주세요.';
  }

  const start = localInputToIso(value.displayStartAt);
  const end = localInputToIso(value.displayEndAt);

  if (start && end && new Date(end) <= new Date(start)) {
    return '게시 종료 일시는 시작 일시보다 뒤여야 합니다.';
  }

  if (value.linkUrl.trim() && !isSafeLink(value.linkUrl.trim())) {
    return '링크는 http(s) 주소이거나 "/" 로 시작하는 사이트 내 경로여야 합니다.';
  }

  return null;
}

export function topNoticeFormToCreateDto(value: TopNoticeFormValue): CreateTopNoticeDto {
  return {
    text: value.text.trim(),
    linkUrl: value.linkUrl.trim() || undefined,
    displayStartAt: localInputToIso(value.displayStartAt),
    displayEndAt: localInputToIso(value.displayEndAt),
    isActive: value.isActive,
    sortOrder: toSortOrder(value.sortOrder),
  };
}

/** 수정은 전체 필드를 보낸다. 비우는 필드는 null 이라야 서버가 지운다. */
export function topNoticeFormToUpdateDto(value: TopNoticeFormValue): UpdateTopNoticeDto {
  return {
    text: value.text.trim(),
    linkUrl: value.linkUrl.trim() || null,
    displayStartAt: localInputToIso(value.displayStartAt) ?? null,
    displayEndAt: localInputToIso(value.displayEndAt) ?? null,
    isActive: value.isActive,
    sortOrder: toSortOrder(value.sortOrder),
  };
}

/** 게시기간까지 반영한 실제 노출 상태. isActive 만 보면 기간이 지나 안 보이는 띠를 노출 중으로 오인한다. */
export function topNoticeDisplayState(
  notice: Pick<TopNoticeDto, 'isActive' | 'displayStartAt' | 'displayEndAt'>,
  now: number = Date.now()
): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (!notice.isActive) return { label: '미사용', variant: 'secondary' };

  const start = notice.displayStartAt ? new Date(notice.displayStartAt).getTime() : null;
  const end = notice.displayEndAt ? new Date(notice.displayEndAt).getTime() : null;

  if (start !== null && now < start) return { label: '예약됨', variant: 'outline' };
  if (end !== null && now >= end) return { label: '종료됨', variant: 'secondary' };

  return { label: '노출 중', variant: 'default' };
}

function toSortOrder(value: string): number {
  const num = Number(value);

  return value.trim() && Number.isInteger(num) ? num : 0;
}

function isSafeLink(url: string): boolean {
  if (url.startsWith('/')) return !url.startsWith('//');

  return /^https?:\/\//i.test(url);
}
