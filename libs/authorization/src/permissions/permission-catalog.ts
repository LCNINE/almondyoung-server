import {
  INITIAL_GRANT_ROLES,
  OwnerService,
  PERMISSION_DOMAINS,
  InitialGrantRole,
  PermissionDefinition,
} from './permission.types';

export { INITIAL_GRANT_ROLES, PERMISSION_DOMAINS };

type Options = {
  owners: readonly OwnerService[];
  grant: readonly InitialGrantRole[];
  dangerous?: boolean;
  systemOnly?: boolean;
};

function permission<const K extends string>(key: K, label: string, description: string, options: Options) {
  return {
    key,
    label,
    description,
    dangerous: options.dangerous ?? false,
    systemOnly: options.systemOnly ?? false,
    ownerServices: options.owners,
    grantOnFirstRegistration: options.grant,
  } satisfies PermissionDefinition;
}

const ADMIN = ['admin'] as const;
const ADMIN_INTERN = ['admin', 'intern'] as const;
const NOBODY = [] as const;
const LOGISTICS = ['logistics_worker', 'logistics_manager'] as const;
const LOGISTICS_MANAGER = ['logistics_manager'] as const;
const DANGEROUS = { dangerous: true } as const;

export const PERMISSION_CATALOG = [
  // 관리자·권한 — 오늘 admin 은 'master','admin:users:read' 류 조회만 통과한다.
  permission('iam.admin_user.read', '관리자 계정 조회', '관리자 계정 목록과 상세를 본다', {
    owners: ['user-service'],
    grant: ADMIN,
  }),
  permission('iam.admin_user.write', '관리자 계정 관리', '관리자 계정을 만들고, 고치고, 비활성으로 바꾼다', {
    owners: ['user-service'],
    grant: NOBODY,
    ...DANGEROUS,
  }),
  permission('iam.role.read', '역할 조회', '역할과 역할별 권한을 본다', { owners: ['user-service'], grant: NOBODY }),
  permission('iam.role.write', '역할 관리', '역할을 만들고, 고치고, 지우고, 권한을 켜고 끈다', {
    owners: ['user-service'],
    grant: NOBODY,
    ...DANGEROUS,
  }),
  permission('iam.role.assign', '역할 부여', '관리자에게 역할을 주거나 회수하고 기간을 정한다', {
    owners: ['user-service'],
    grant: NOBODY,
    ...DANGEROUS,
  }),
  permission('iam.audit_log.read', '권한 변경 이력 조회', '역할·권한·부여 변경 이력을 본다', {
    owners: ['user-service'],
    grant: ADMIN,
  }),
  permission(
    'iam.pii_access_log.read',
    '개인정보 접속기록 조회',
    '개인정보 열람·다운로드 기록을 보고 월 점검을 남긴다',
    { owners: ['user-service'], grant: NOBODY, ...DANGEROUS },
  ),

  // 고객
  permission('customer.profile.read', '회원 조회', '회원 목록과 상세를 본다(개인정보는 가려진다)', {
    owners: ['user-service', 'core'],
    grant: ADMIN_INTERN,
  }),
  permission('customer.profile.write', '회원 정보 수정', '회원 정보와 상태를 고친다', {
    owners: ['user-service'],
    grant: ADMIN,
  }),
  permission('customer.pii.read', '개인정보 보기', '가려진 이름·연락처·주소·계좌의 원본을 본다(열람 기록이 남는다)', {
    owners: ['user-service', 'core', 'membership', 'notification', 'wallet', 'admin-web'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('customer.profile.export', '회원 내보내기', '회원 목록을 엑셀로 내려받는다', {
    owners: ['user-service'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('customer.account.archive', '회원 보관·완전삭제', '회원 계정을 보관하거나 완전히 지운다', {
    owners: ['user-service'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('customer.dormant.execute', '휴면 전환 실행', '휴면 대상 회원을 일괄 전환한다', {
    owners: ['user-service'],
    grant: NOBODY,
    ...DANGEROUS,
  }),
  permission('customer.blacklist.write', '블랙리스트 관리', '블랙리스트에 올리고 내린다', {
    owners: ['user-service'],
    grant: ADMIN,
  }),
  permission('customer.business_verification.review', '사업자 인증 검토', '사업자 인증 신청을 승인·반려한다', {
    owners: ['user-service'],
    grant: ADMIN,
  }),

  // 주문
  permission('order.order.read', '주문 조회', '주문 목록·상세·정체 보드를 본다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN_INTERN,
  }),
  permission('order.order.write', '주문 입력·수정', '주문을 수동 입력하고 상태를 바꾼다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
  }),
  permission('order.order.cancel', '주문 취소', '주문을 취소한다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('order.order.export', '주문 내보내기', '주문 목록을 엑셀로 내려받는다', {
    owners: ['core'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('order.matching.write', '주문 매칭', '수집한 주문을 상품과 매칭한다', { owners: ['core'], grant: ADMIN }),
  permission('order.claim.read', '반품·교환 조회', '반품·교환 접수 내역을 본다', {
    owners: ['core'],
    grant: ADMIN_INTERN,
  }),
  permission('order.claim.write', '반품·교환 처리', '반품·교환을 접수하고 처리한다', {
    owners: ['core'],
    grant: ADMIN,
  }),

  // 출고 — 오늘 admin 매핑에는 출고 스코프가 없다(master·물류 역할만).
  permission('fulfillment.order.read', '출고 현황 조회', '출고 요청·직배송·주문 진행 현황을 본다', {
    owners: ['core'],
    grant: ['admin', 'intern', ...LOGISTICS],
  }),
  permission('fulfillment.order.write', '출고 요청 처리', '직배송을 전달·완료하고 출고 요청을 만들고 취소한다', {
    owners: ['core'],
    grant: ADMIN,
  }),
  // 상자·배치·송장 조회는 오늘 출고 작업 권한 뒤에 있어 admin 도 통과하지 못한다.
  permission('fulfillment.shipment.read', '출고 작업 조회', '출고 상자·배치·송장 상세를 본다', {
    owners: ['core'],
    grant: LOGISTICS,
  }),
  permission('fulfillment.warehouse.operate', '출고 현장 작업', '일반 출고 계획·피킹·패킹·검수를 한다', {
    owners: ['core'],
    grant: LOGISTICS,
  }),
  permission('fulfillment.shipment.consolidate', '합배송', '서로 다른 주문의 출고를 합친다', {
    owners: ['core'],
    grant: LOGISTICS_MANAGER,
  }),
  permission(
    'fulfillment.shipment.override_recipient',
    '수취 정보 변경 확정',
    '주문 원본과 다른 수취 정보로 확정한다',
    { owners: ['core'], grant: LOGISTICS_MANAGER, ...DANGEROUS },
  ),
  permission('fulfillment.reservation.transfer', '예약 이전', '출고 라인 예약을 옮기고 우선순위를 바꾼다', {
    owners: ['core'],
    grant: LOGISTICS_MANAGER,
  }),
  permission('fulfillment.dispatch.force', '강제 출고', '출고를 강제로 완료한다', {
    owners: ['core'],
    grant: LOGISTICS_MANAGER,
    ...DANGEROUS,
  }),
  permission('fulfillment.dispatch.recall', '출고 회수', '출고 시도를 되돌린다', {
    owners: ['core'],
    grant: LOGISTICS_MANAGER,
    ...DANGEROUS,
  }),
  permission('fulfillment.shipment.reopen', '출고 재개방', '잠긴 출고를 다시 열고 송장을 무효로 한다', {
    owners: ['core'],
    grant: LOGISTICS_MANAGER,
    ...DANGEROUS,
  }),
  permission('fulfillment.shipment.short_pick', '결품 보고', '스테이션 결품·파손을 보고한다', {
    owners: ['core'],
    grant: LOGISTICS,
  }),
  permission('fulfillment.dispatch.station_force', '스테이션 강제 출고', '남은 미스캔 수량을 채우고 출고한다', {
    owners: ['core'],
    grant: LOGISTICS,
    ...DANGEROUS,
  }),
  permission(
    'fulfillment.work.supervise',
    '현장 작업 감독',
    '다른 작업자가 잡은 피킹·패킹·토트·카트를 넘기거나 되돌린다',
    {
      owners: ['core'],
      grant: LOGISTICS_MANAGER,
    },
  ),
  permission('fulfillment.tracking.ingest', '배송 추적 수신', '배송사 추적 이벤트를 받는다(시스템 전용)', {
    owners: ['core'],
    grant: NOBODY,
    systemOnly: true,
  }),

  // 재고
  permission('inventory.stock.read', '재고 조회', '재고 현황·이동·예약·실사 결과를 본다', {
    owners: ['core'],
    grant: ['admin', 'intern', ...LOGISTICS],
  }),
  permission('inventory.master.read', '재고 기준정보 조회', '공급처·보관주체·로케이션 구성·보충 규칙을 본다', {
    owners: ['core'],
    grant: ['admin', 'intern', ...LOGISTICS_MANAGER],
  }),
  permission('inventory.stock.operate', '재고 현장 작업', '입고·적치·실사 카운트·이동을 한다', {
    owners: ['core'],
    grant: ['admin', ...LOGISTICS],
  }),
  permission('inventory.stock.adjust', '재고 조정', '수량을 직접 고치고 실사 차이를 반영한다', {
    owners: ['core'],
    grant: ['admin', ...LOGISTICS_MANAGER],
    ...DANGEROUS,
  }),
  permission('inventory.master.write', '재고 기준정보 관리', 'SKU·로케이션·보관주체·공급처·발주를 관리한다', {
    owners: ['core'],
    grant: ['admin', ...LOGISTICS_MANAGER],
  }),
  permission('inventory.warehouse.write', '창고 관리', '창고를 만들고 고치고 피킹 방식을 정한다', {
    owners: ['core'],
    grant: ['admin', ...LOGISTICS_MANAGER],
  }),

  // 상품
  permission('catalog.product.read', '상품 조회', '상품 목록·상세·감사 이력을 본다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN_INTERN,
  }),
  permission('catalog.product.write', '상품 등록·수정', '상품을 등록하고 고친다(가격 제외)', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
  }),
  permission('catalog.product.delete', '상품 삭제', '상품을 휴지통으로 보내거나 지운다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('catalog.product.export', '상품 내보내기', '상품 목록을 엑셀로 내려받는다', {
    owners: ['core'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('catalog.price.write', '가격 변경', '판매가·할인가를 바꾼다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('catalog.bulk.execute', '상품 일괄 작업', '엑셀 일괄 등록·수정과 일괄 작업을 실행한다', {
    owners: ['core'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('catalog.category.write', '카테고리 관리', '분류·카테고리·태그를 관리한다', {
    owners: ['core'],
    grant: ADMIN,
  }),
  permission('catalog.channel_listing.write', '채널 노출 관리', '채널별 노출과 채널 카테고리를 관리한다', {
    owners: ['core', 'channel-adapter'],
    grant: ADMIN,
  }),
  permission('catalog.digital_asset.write', '디지털 자산 관리', '디지털 자산과 사용권을 관리한다', {
    owners: ['core'],
    grant: ADMIN,
  }),

  // 리뷰·CS — 오늘 ugc 의 admin:ugc:read/modify 를 admin 이 갖는다.
  permission('cs.review.read', '리뷰 조회', '리뷰와 리뷰 통계를 본다', {
    owners: ['ugc-service'],
    grant: ADMIN_INTERN,
  }),
  permission('cs.review.moderate', '리뷰 관리', '리뷰에 답하고 숨기고 작성한다', {
    owners: ['ugc-service'],
    grant: ADMIN,
  }),
  permission('cs.reward_policy.write', '리뷰 보상 정책', '리뷰 보상 규칙을 바꾼다', {
    owners: ['ugc-service'],
    grant: ADMIN,
  }),
  permission('cs.inquiry.read', '문의 조회', 'Q&A·CS 목록을 본다', {
    owners: ['ugc-service', 'core'],
    grant: ADMIN_INTERN,
  }),
  permission('cs.inquiry.write', '문의 답변', 'Q&A·CS 에 답하고 처리한다', {
    owners: ['ugc-service', 'core'],
    grant: ADMIN,
  }),
  permission('cs.chatbot.write', '챗봇 설정', '챗봇 설정을 바꾼다', { owners: ['ai', 'core'], grant: ADMIN }),

  // 마케팅
  permission('marketing.promotion.read', '프로모션 조회', '쿠폰·타임세일·이벤트·적립 정책을 본다', {
    owners: ['admin-web', 'core'],
    grant: ADMIN_INTERN,
  }),
  permission('marketing.promotion.write', '프로모션 관리', '쿠폰·타임세일·이벤트를 만들고 고친다', {
    owners: ['admin-web', 'core'],
    grant: ADMIN,
  }),
  permission('marketing.display.write', '전시 관리', '배너·팝업·진열·화면을 관리한다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
  }),
  permission('marketing.display.read', '전시·공지 조회', '배너·팝업·공지를 본다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN_INTERN,
  }),
  permission('marketing.notice.write', '공지 관리', '공지사항을 쓰고 고친다', { owners: ['core'], grant: ADMIN }),
  permission('marketing.shop_listing.write', '샵매매 관리', '샵매매 글을 작성·검토한다', {
    owners: ['ugc-service'],
    grant: ADMIN,
  }),
  permission('marketing.almond_template.write', '아몬드템플릿 관리', '아몬드템플릿 시안을 저장·게시·삭제한다', {
    owners: ['ugc-service'],
    grant: ADMIN,
  }),
  permission('marketing.almond_template.read', '아몬드템플릿 조회', '아몬드템플릿 시안과 디자인을 본다', {
    owners: ['ugc-service'],
    grant: ADMIN_INTERN,
  }),

  // 메시지
  permission('messaging.message.read', '메시지 조회', '발송 목록·메시지함·템플릿을 본다', {
    owners: ['notification'],
    grant: ADMIN_INTERN,
  }),
  permission('messaging.message.send', '개별 메시지 발송', '한 명에게 문자·알림톡을 보낸다', {
    owners: ['notification'],
    grant: ADMIN,
  }),
  permission('messaging.message.bulk_send', '대량 발송', '여러 명에게 문자·알림톡을 보낸다', {
    owners: ['notification'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('messaging.template.write', '메시지 템플릿 관리', '문자·알림톡 템플릿을 등록하고 고친다', {
    owners: ['notification'],
    grant: ADMIN,
  }),
  permission('messaging.device.write', '발송폰 관리', '발송폰 디바이스를 관리한다', {
    owners: ['notification'],
    grant: ADMIN,
  }),
  permission('messaging.provider.write', '발송 채널 관리', '문자·알림톡 발송 프로바이더를 등록하고 전환한다', {
    owners: ['notification'],
    grant: ADMIN,
  }),

  // 결제
  permission('payment.payment.read', '결제 조회', '결제 내역을 본다', { owners: ['wallet'], grant: ADMIN_INTERN }),
  permission('payment.refund.read', '환불 조회', '환불 내역과 환불 신청을 본다', {
    owners: ['wallet', 'core'],
    grant: ADMIN_INTERN,
  }),
  permission('payment.refund.execute', '환불 실행', '환불을 실행하거나 수동 송금을 확정한다', {
    owners: ['wallet', 'core'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('payment.payment.write', '결제 처리', '결제를 승인 확정·취소·정리하고 현금영수증을 발행한다', {
    owners: ['wallet'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('payment.billing.execute', '정기결제 실행', '정기결제 청구서를 실행하고 자동이체 상태를 다시 조회한다', {
    owners: ['wallet'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('payment.deposit.confirm', '무통장입금 확인', '입금을 확인 처리한다', {
    owners: ['wallet'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('payment.point.adjust', '적립금 지급·차감', '고객 적립금을 지급하거나 차감한다', {
    owners: ['wallet'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('payment.method.write', '결제수단 관리', '결제수단과 리전별 결제수단을 관리한다', {
    owners: ['wallet', 'admin-web'],
    grant: ADMIN,
  }),

  // 멤버십 — 오늘 admin 은 billing.refund 만, override 는 master 만.
  permission('membership.member.read', '멤버십 회원 조회', '멤버십 회원·정기결제·미납 현황을 본다', {
    owners: ['membership', 'wallet'],
    grant: ADMIN_INTERN,
  }),
  permission('membership.member.write', '멤버십 회원 관리', '수기 지급·해지 등 회원 상태를 바꾼다', {
    owners: ['membership'],
    grant: ADMIN,
  }),
  permission('membership.billing.read', '멤버십 결제 조회', '결제·해지 내역을 본다', {
    owners: ['membership', 'wallet'],
    grant: ADMIN_INTERN,
  }),
  permission('membership.billing.refund', '멤버십 환불', '멤버십 결제를 환불한다', {
    owners: ['membership'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('membership.billing.refund_override', '멤버십 환불 금액 조정', '정책 계산과 다른 금액으로 환불한다', {
    owners: ['membership'],
    grant: NOBODY,
    ...DANGEROUS,
  }),
  permission('membership.plan.write', '멤버십 플랜 관리', '플랜과 혜택을 관리한다', {
    owners: ['membership'],
    grant: ADMIN,
  }),

  // 통계
  permission('analytics.report.read', '통계 조회', '판매·유입·고객·리뷰 통계를 본다', {
    owners: ['analytics', 'search', 'wallet', 'core'],
    grant: ADMIN_INTERN,
  }),
  permission('analytics.finance.read', '이익·경영 통계 조회', '원가·이익·재고 금액·경영진단을 본다', {
    owners: ['analytics', 'core'],
    grant: ADMIN,
    ...DANGEROUS,
  }),
  permission('analytics.setting.write', '경영 설정', '고정비·매출 목표·수수료율을 바꾼다', {
    owners: ['analytics'],
    grant: ADMIN,
  }),
  permission('analytics.keyword.write', '검색어 운영', '검색어 이슈를 표시하고 정리한다', {
    owners: ['search'],
    grant: ADMIN,
  }),

  // 채널
  permission('channel.account.read', '판매처 조회', '판매처(채널) 연동 정보와 발송 현황을 본다', {
    owners: ['channel-adapter'],
    grant: ADMIN_INTERN,
  }),
  permission('channel.account.write', '판매처 관리', '판매처 연동 정보를 바꾼다', {
    owners: ['channel-adapter'],
    grant: ADMIN,
  }),

  // 설정 — oauth-clients 는 오늘 'master' 단독이다.
  permission('system.region.write', '리전 설정', '통화·세금·리전을 바꾼다', {
    owners: ['admin-web', 'wallet'],
    grant: ADMIN,
  }),
  permission('system.shipping_profile.write', '배송 설정', '배송 프로필·배송비 그룹을 바꾼다', {
    owners: ['core', 'admin-web'],
    grant: ADMIN,
  }),
  permission('system.oauth_client.write', 'OAuth 클라이언트 관리', 'OAuth 클라이언트를 등록하고 키를 회전한다', {
    owners: ['user-service'],
    grant: NOBODY,
    ...DANGEROUS,
  }),
  permission('system.menu.write', '메뉴 커스터마이즈', '관리자 메뉴 구성을 바꾼다', {
    owners: ['admin-web'],
    grant: ADMIN,
  }),
  permission(
    'system.file.manage',
    '모든 파일 열람·삭제',
    '올린 사람이 아니어도 비공개 파일을 열고 지운다(고객이 올린 서류 포함)',
    { owners: ['file-service'], grant: NOBODY, ...DANGEROUS },
  ),
  permission('system.operations.read', '운영 진단 조회', '이벤트 추적과 상세 헬스 정보를 본다', {
    owners: ['core', 'user-service', 'membership', 'wallet', 'notification', 'channel-adapter'],
    grant: ADMIN,
  }),

  // 문서·AI
  permission('archive.page.read', '문서 조회', '아카이브 문서를 본다', { owners: ['core'], grant: ADMIN_INTERN }),
  permission('archive.page.write', '문서 작성', '아카이브 문서를 쓰고 고친다', { owners: ['core'], grant: ADMIN }),
  permission('ai.assistant.use', 'AI 어시스턴트', 'AI 어시스턴트와 상품설명 초안을 쓴다(내 권한 범위 안에서만 동작)', {
    owners: ['ai'],
    grant: ADMIN,
  }),
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number]['key'];

const BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map(PERMISSION_CATALOG.map((p) => [p.key, p]));

export function findPermission(key: string): PermissionDefinition | undefined {
  return BY_KEY.get(key);
}

export function isPermission(key: string): key is Permission {
  return BY_KEY.has(key);
}
