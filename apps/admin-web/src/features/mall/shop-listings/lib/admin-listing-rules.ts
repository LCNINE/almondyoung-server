import { isCustomError } from '@/lib/api/customError';
import type {
  AdminShopListingDto,
  AdminShopListingListQuery,
  AdminShopListingPayload,
  ShopListingAuthorType,
  ShopListingBusinessType,
  ShopListingDealType,
  ShopListingModerationDto,
  ShopListingRegion,
  ShopListingStatus,
} from '@/lib/types/dto/products';

export type AdminListingAction = 'approve' | 'reject' | 'hide' | 'unhide' | 'close' | 'reopen';

// 서버 전이표(spec §5)의 관리자 몫. rejected 는 회원이 고쳐 재제출할 때까지 할 일이 없다.
const ACTIONS: Record<ShopListingStatus, readonly AdminListingAction[]> = {
  pending: ['approve', 'reject'],
  published: ['hide', 'close'],
  closed: ['hide', 'reopen'],
  hidden: ['unhide'],
  rejected: [],
};

export function adminListingActions(status: ShopListingStatus): readonly AdminListingAction[] {
  return ACTIONS[status];
}

export const SHOP_LISTING_STATUS_LABELS: Record<ShopListingStatus, string> = {
  pending: '검토 대기',
  published: '게시 중',
  rejected: '반려',
  hidden: '숨김',
  closed: '거래완료',
};

export const SHOP_LISTING_MODERATION_LABELS: Record<ShopListingModerationDto['decision'], string> = {
  approved: '승인',
  rejected: '반려',
  pending: '검토 대기',
  hidden: '숨김',
  unhidden: '숨김 해제',
};

export const SHOP_LISTING_AUTHOR_LABELS: Record<ShopListingAuthorType, string> = {
  admin: '관리자',
  member: '회원',
};

export const SHOP_LISTING_STATUS_TABS: readonly { value: ShopListingStatus | 'all'; label: string }[] = [
  { value: 'pending', label: '검토 대기' },
  { value: 'published', label: '게시 중' },
  { value: 'rejected', label: '반려' },
  { value: 'hidden', label: '숨김' },
  { value: 'closed', label: '거래완료' },
  { value: 'all', label: '전체' },
];

export function buildAdminListQuery(
  tab: ShopListingStatus | 'all',
  author: ShopListingAuthorType | 'all',
  q: string,
): AdminShopListingListQuery {
  const query: AdminShopListingListQuery = {};
  if (tab !== 'all') query.status = tab;
  if (author !== 'all') query.authorType = author;
  const trimmed = q.trim();
  if (trimmed) query.q = trimmed;
  return query;
}

/** 금액은 만원 단위 문자열 (기존 폼과 같다) */
export interface AdminShopListingFormValues {
  title: string;
  content: string;
  region: ShopListingRegion | '';
  businessType: ShopListingBusinessType | '';
  dealType: ShopListingDealType;
  areaPyeong: string;
  deposit: string;
  monthlyRent: string;
  keyMoney: string;
  imageFileIds: string[];
  contactPhone: string;
  kakaoOpenChatUrl: string;
}

export type AdminFormField =
  | 'title'
  | 'region'
  | 'businessType'
  | 'imageFileIds'
  | 'content'
  | 'contactPhone'
  | 'kakaoOpenChatUrl';

const toManwon = (won: number | null): string => (won === null ? '' : String(won / 10_000));
const toWon = (manwon: string): number | null => (manwon.trim() === '' ? null : Number(manwon) * 10_000);
const PHONE_PATTERN = /^0\d{8,10}$/;

export function adminFormValuesFrom(listing: AdminShopListingDto | undefined): AdminShopListingFormValues {
  return {
    title: listing?.title ?? '',
    content: listing?.content ?? '',
    region: listing?.region ?? '',
    businessType: listing?.businessType ?? '',
    dealType: listing?.dealType ?? 'transfer',
    areaPyeong: listing && listing.areaPyeong !== null ? String(listing.areaPyeong) : '',
    deposit: toManwon(listing?.deposit ?? null),
    monthlyRent: toManwon(listing?.monthlyRent ?? null),
    keyMoney: toManwon(listing?.keyMoney ?? null),
    imageFileIds: listing?.imageFileIds ?? [],
    contactPhone: listing?.contactPhone ?? '',
    kakaoOpenChatUrl: listing?.kakaoOpenChatUrl ?? '',
  };
}

export type BuildAdminPayloadResult =
  | { ok: true; payload: AdminShopListingPayload }
  | { ok: false; field: AdminFormField; message: string };

/**
 * 관리자 PUT 은 전체 교체다. 연락처 두 키는 **항상** 싣는다 — 빼면 서버가 회원이 등록한 번호를 null 로 덮는다.
 * 화면 위에서 아래 순서로 첫 문제 칸 하나를 돌려준다.
 */
export function buildAdminPayload(values: AdminShopListingFormValues): BuildAdminPayloadResult {
  const title = values.title.trim();
  if (!title) return { ok: false, field: 'title', message: '제목을 입력해 주세요.' };
  if (title.length > 255) return { ok: false, field: 'title', message: '제목은 255자까지 쓸 수 있어요.' };
  if (!values.region) return { ok: false, field: 'region', message: '지역을 선택해 주세요.' };
  if (!values.businessType) return { ok: false, field: 'businessType', message: '업종을 선택해 주세요.' };
  if (values.imageFileIds.length === 0 || values.imageFileIds.length > 15) {
    return { ok: false, field: 'imageFileIds', message: '샵 사진을 1~15장 올려 주세요.' };
  }
  if (!values.content.trim() || values.content.length > 10_000) {
    return { ok: false, field: 'content', message: '본문을 입력해 주세요. (10,000자까지)' };
  }

  const phone = values.contactPhone.replace(/[\s-]/g, '');
  if (phone && !PHONE_PATTERN.test(phone)) {
    return { ok: false, field: 'contactPhone', message: '전화번호는 0 으로 시작하는 9~11자리여야 해요.' };
  }
  const kakao = values.kakaoOpenChatUrl.trim();
  if (kakao && !kakao.startsWith('https://open.kakao.com/')) {
    return { ok: false, field: 'kakaoOpenChatUrl', message: '카카오 오픈채팅 주소(https://open.kakao.com/…)만 넣을 수 있어요.' };
  }

  return {
    ok: true,
    payload: {
      title,
      content: values.content,
      region: values.region,
      businessType: values.businessType,
      dealType: values.dealType,
      areaPyeong: values.areaPyeong.trim() === '' ? null : Number(values.areaPyeong),
      deposit: toWon(values.deposit),
      monthlyRent: toWon(values.monthlyRent),
      keyMoney: toWon(values.keyMoney),
      imageFileIds: values.imageFileIds,
      contactPhone: phone || null,
      kakaoOpenChatUrl: kakao || null,
    },
  };
}

/** 승인·반려 409 = 그사이 회원이 고쳤거나 상태가 바뀌었다. 새로고침으로 안내한다 */
export function isModerationConflict(error: unknown): boolean {
  return isCustomError(error) && error.statusCode === 409;
}
