// masking.util.ts - 민감값 마스킹 유틸리티

/**
 * 전화번호 마스킹
 * @param phone 전화번호 (예: "01012345678")
 * @returns 마스킹된 전화번호 (예: "010****5678")
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return phone;

  // 하이픈 제거
  const cleaned = phone.replace(/-/g, '');

  if (cleaned.length === 11) {
    // 010-1234-5678 형태
    return `${cleaned.slice(0, 3)}****${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    // 02-123-4567 형태
    return `${cleaned.slice(0, 3)}****${cleaned.slice(6)}`;
  }

  return phone; // 예상 외 형태는 그대로 반환
}

/**
 * 카드번호 마스킹 (뒤 4자리만 추출)
 * @param cardNumber 카드번호 (예: "1234567890123456")
 * @returns 뒤 4자리 (예: "3456")
 */
export function extractCardLast4(cardNumber: string): string {
  if (!cardNumber || cardNumber.length < 4) return '';
  return cardNumber.slice(-4);
}

/**
 * 결제자명 마스킹 (중간 글자 마스킹)
 * @param name 이름 (예: "홍길동")
 * @returns 마스킹된 이름 (예: "홍*동")
 */
export function maskPayerName(name: string): string {
  if (!name || name.length <= 2) return name;

  if (name.length === 3) {
    return `${name[0]}*${name[2]}`;
  } else if (name.length === 4) {
    return `${name[0]}**${name[3]}`;
  } else {
    // 5글자 이상인 경우
    const firstChar = name[0];
    const lastChar = name[name.length - 1];
    const middleMask = '*'.repeat(name.length - 2);
    return `${firstChar}${middleMask}${lastChar}`;
  }
}

/**
 * 카드사 코드를 브랜드명으로 변환
 * @param paymentCompany 카드사 코드 (예: "088")
 * @returns 브랜드명 (예: "SHINHAN")
 */
export function getCardBrand(paymentCompany: string): string {
  const brandMap: Record<string, string> = {
    '088': 'SHINHAN',
    '004': 'KB',
    '023': 'SC',
    '027': 'CITI',
    '011': 'NH',
    '003': 'IBK',
    '020': 'WOORI',
    '032': 'BUSAN',
    '045': 'SAEMAUL',
    '071': 'POST',
    '081': 'HANA',
    '089': 'KBANK',
    '090': 'KAKAOBANK',
    '092': 'TOSSBANK',
  };

  return brandMap[paymentCompany] || 'UNKNOWN';
}

/**
 * 계좌번호 마스킹 (앞 3자리 + 마스킹 + 뒤 3자리)
 * @param accountNumber 계좌번호
 * @returns 마스킹된 계좌번호
 */
export function maskAccountNumber(accountNumber: string): string {
  if (!accountNumber || accountNumber.length < 6) return accountNumber;

  const front = accountNumber.slice(0, 3);
  const back = accountNumber.slice(-3);
  const middleLength = accountNumber.length - 6;
  const middle = '*'.repeat(Math.max(middleLength, 4));

  return `${front}${middle}${back}`;
}

/**
 * UI용 프로필 이름 생성
 * @param kind 프로필 종류
 * @param cardBrand 카드 브랜드 (카드인 경우)
 * @param cardLast4 카드 뒤 4자리 (카드인 경우)
 * @param paymentCompany 은행 코드 (배치인 경우)
 * @returns UI 표시용 이름 (예: "신한 **3456", "KB 계좌")
 */
export function generateProfileName(
  kind: 'CARD' | 'BATCH',
  cardBrand?: string,
  cardLast4?: string,
  paymentCompany?: string,
): string {
  if (kind === 'CARD') {
    const brand = cardBrand || 'CARD';
    const last4 = cardLast4 ? `**${cardLast4}` : '';
    return `${brand} ${last4}`.trim();
  } else {
    const bankName = getCardBrand(paymentCompany || '');
    return `${bankName} 계좌`;
  }
}
