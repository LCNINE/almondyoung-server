export const PERMISSION_DOMAINS = {
  iam: '관리자·권한',
  customer: '고객',
  order: '주문',
  fulfillment: '출고',
  inventory: '재고',
  catalog: '상품',
  cs: '리뷰·CS',
  marketing: '마케팅',
  messaging: '메시지',
  payment: '결제',
  membership: '멤버십',
  analytics: '통계',
  channel: '채널',
  system: '설정',
  archive: '문서',
  ai: 'AI',
} as const;

export type PermissionDomain = keyof typeof PERMISSION_DOMAINS;

/** 초기 부여에 쓸 수 있는 역할. master 는 «전체»를 계산해서 받으므로 여기 없다. */
export const INITIAL_GRANT_ROLES = ['admin', 'intern', 'logistics_worker', 'logistics_manager'] as const;
export type InitialGrantRole = (typeof INITIAL_GRANT_ROLES)[number];

export type OwnerService =
  | 'core'
  | 'user-service'
  | 'wallet'
  | 'membership'
  | 'notification'
  | 'channel-adapter'
  | 'ugc-service'
  | 'analytics'
  | 'ai'
  | 'file-service'
  | 'search'
  | 'admin-web';

export interface PermissionDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** 인턴 기본값에서 항상 빠지고 화면에서 강조된다. */
  readonly dangerous: boolean;
  /** 기계 호출 전용. 역할 편집 화면에 안 보이고 사람에게 부여하지 않는다. */
  readonly systemOnly: boolean;
  /** 판정 API 가 있는 곳. 영역(업무)과 서비스는 다를 수 있다. */
  readonly ownerServices: readonly OwnerService[];
  /** 이 키가 DB 에 «처음» 들어갈 때 한 번만 부여한다. 이후엔 화면에서 바꾼 값이 원본이다. */
  readonly grantOnFirstRegistration: readonly InitialGrantRole[];
  /**
   * 이 권한을 켜려면 함께 있어야 하는 조회 권한. 같은 대상의 `.read` 는 적지 않아도 포함된다.
   * 역할 편집 화면은 켤 때 함께 켜고, 서버는 빠진 집합을 거부한다.
   */
  readonly requires: readonly string[];
  /** 쓰기·특수 동작인데 기대는 조회가 없다(진입 권한이 자기 자신이거나 조회 화면이 없다). */
  readonly standalone: boolean;
}
