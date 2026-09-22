import { MARKETING_FOOTER, MARKETING_PREFIX } from '../lib/sms-body';

export type NotificationGroup = '주문' | 'CS' | '회원' | '멤버십' | '광고';

export const NOTIFICATION_GROUPS: NotificationGroup[] = ['주문', 'CS', '회원', '멤버십', '광고'];

export type CatalogEntry = {
  id: string;
  group: NotificationGroup;
  title: string;
  condition: string;
} & (
  | { kind: 'event'; eventKey: string }
  | { kind: 'fixed'; channel: 'SMS' | 'KAKAO'; text: string }
  | { kind: 'link'; href: string; linkLabel: string }
  | { kind: 'planned'; issue: number }
);

export const NOTIFICATION_CATALOG: CatalogEntry[] = [
  { id: 'order-created', group: '주문', title: '주문 완료 안내', condition: '주문이 접수되면', kind: 'event', eventKey: 'ORDER_CREATED' },
  { id: 'bank-transfer', group: '주문', title: '무통장 입금 안내', condition: '무통장입금 결제를 신청하면 입금 계좌와 기한을 보낸다', kind: 'event', eventKey: 'BANK_TRANSFER_ISSUED' },
  { id: 'shipped', group: '주문', title: '발송 완료', condition: '주문 상품이 모두 출고되면', kind: 'event', eventKey: 'ORDER_SHIPPED' },
  { id: 'partially-shipped', group: '주문', title: '부분 발송 완료', condition: '주문 상품 중 일부가 먼저 출고되면', kind: 'event', eventKey: 'ORDER_PARTIALLY_SHIPPED' },

  { id: 'claim-requested', group: 'CS', title: '반품/교환 신청', condition: '고객이 마이페이지에서 반품·교환을 신청하면', kind: 'event', eventKey: 'CLAIM_REQUESTED' },
  { id: 'claim-received', group: 'CS', title: '반품/교환 접수', condition: '관리자가 CS 화면에서 반품을 접수하면', kind: 'event', eventKey: 'CLAIM_RECEIVED' },
  { id: 'pickup-completed', group: 'CS', title: '수거 완료', condition: '반품·교환 상품 수거를 완료 처리하면', kind: 'event', eventKey: 'CLAIM_COLLECTED' },
  { id: 'claim-completed', group: 'CS', title: '반품/교환 완료', condition: '반품·교환 처리가 끝나면', kind: 'event', eventKey: 'CLAIM_COMPLETED' },
  { id: 'refund-completed', group: 'CS', title: '환불 완료', condition: '주문 취소·반품 환불이 완료되면', kind: 'event', eventKey: 'REFUND_COMPLETED' },
  { id: 'inquiry-answered', group: 'CS', title: '문의 답변 완료', condition: '상품·1:1 문의에 답변이 등록되면', kind: 'event', eventKey: 'QNA_ANSWERED' },

  { id: 'signup', group: '회원', title: '회원 가입', condition: '회원 가입이 완료되면', kind: 'event', eventKey: 'USER_WELCOME' },
  { id: 'phone-verification', group: '회원', title: '본인확인 인증번호 발송', condition: '휴대폰 본인확인을 요청하면', kind: 'fixed', channel: 'SMS', text: '[아몬드영] 인증번호: 123456' },
  { id: 'email-verification', group: '회원', title: '회원인증 요청', condition: '가입 후 이메일 인증 링크를 보낸다', kind: 'event', eventKey: 'USER_VERIFICATION' },
  { id: 'email-verification-code', group: '회원', title: '이메일 인증코드', condition: '이메일 인증코드를 요청하면', kind: 'event', eventKey: 'USER_VERIFICATION_CODE' },
  { id: 'password-changed', group: '회원', title: '비밀번호 안내', condition: '비밀번호가 변경되면', kind: 'event', eventKey: 'USER_PASSWORD_CHANGED' },
  { id: 'coupon-expiring', group: '회원', title: '쿠폰 만료예정', condition: '보유한 쿠폰이 3일 안에 만료되면', kind: 'event', eventKey: 'COUPON_EXPIRING' },
  { id: 'withdrawal', group: '회원', title: '회원 탈퇴', condition: '회원 탈퇴가 완료되면', kind: 'event', eventKey: 'USER_WITHDRAWN' },

  { id: 'membership-joined', group: '멤버십', title: '멤버십 회원 가입', condition: '멤버십에 새로 가입하면', kind: 'event', eventKey: 'MEMBERSHIP_JOINED' },
  { id: 'membership-cancelled', group: '멤버십', title: '멤버십 회원 해지', condition: '멤버십이 해지되거나 해지 예약되면', kind: 'event', eventKey: 'MEMBERSHIP_CANCELLED' },
  { id: 'membership-renewal', group: '멤버십', title: '자동갱신 사전 고지', condition: '자동 갱신 결제 7일 전', kind: 'event', eventKey: 'MEMBERSHIP_RENEWAL_UPCOMING' },
  { id: 'membership-expiry', group: '멤버십', title: '멤버십 만료 사전 안내', condition: '멤버십 만료 7일 전', kind: 'event', eventKey: 'MEMBERSHIP_EXPIRY_UPCOMING' },
  { id: 'mandate-pending', group: '멤버십', title: '멤버십 선적용 안내', condition: '자동이체 계좌 심사 중에 멤버십을 먼저 적용하면', kind: 'event', eventKey: 'MANDATE_PENDING' },
  { id: 'cms-registered', group: '멤버십', title: '자동이체 계좌 등록 완료', condition: '자동이체 계좌 심사가 통과되면', kind: 'event', eventKey: 'CMS_MEMBER_REGISTERED' },
  { id: 'cms-rejected', group: '멤버십', title: '자동이체 계좌 등록 실패', condition: '자동이체 계좌 심사가 반려되면', kind: 'event', eventKey: 'CMS_MEMBER_REJECTED' },

  { id: 'bulk-campaign', group: '광고', title: '대량 문자 나눠 보내기', condition: '발송폰 한도에 맞춰 09~20시 사이에 하루하루 나눠 보낸다', kind: 'link', href: '/messages/campaigns', linkLabel: '발송 목록' },
  { id: 'opt-out-footer', group: '광고', title: '광고 문자 수신거부 문구', condition: '광고 문자 앞뒤에 자동으로 붙는다', kind: 'fixed', channel: 'SMS', text: `${MARKETING_PREFIX} (본문)\n${MARKETING_FOOTER}` },
  { id: 'opt-out-reply', group: '광고', title: '수신거부 처리 안내', condition: "광고 문자에 '수신거부' 답장이 오면", kind: 'fixed', channel: 'SMS', text: '[아몬드영] 광고성 문자 수신거부가 처리되었습니다.' },
];
