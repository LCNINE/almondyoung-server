/**
 * PIN 보안 정책 유틸리티
 *
 * 취약한 PIN 패턴을 감지합니다.
 */
export class PinPolicyUtil {
  /**
   * PIN이 보안 정책을 만족하는지 검증합니다.
   * @param pin 6자리 숫자 PIN
   * @returns 정책 위반 시 false
   */
  static isValid(pin: string): boolean {
    // 1. 숫자만 허용 및 6자리 확인
    if (!/^\d{6}$/.test(pin)) {
      console.log('숫자만 허용 및 6자리 확인', pin);
      return false;
    }

    // 2. 동일 숫자 반복 체크 (예: 111111, 000000)
    if (this.isRepetitive(pin)) {
      console.log('동일 숫자 반복 체크', pin);
      return false;
    }

    // 3. 연속된 숫자 체크 (예: 123456, 987654)
    if (this.isSequential(pin)) {
      console.log('연속된 숫자 체크', pin);
      return false;
    }

    console.log('보안 정책 통과', pin);
    return true;
  }

  /**
   * 동일 숫자 반복 여부 확인
   */
  private static isRepetitive(pin: string): boolean {
    const firstDigit = pin[0];
    return pin.split('').every((digit) => digit === firstDigit);
  }

  /**
   * 연속된 숫자 여부 확인 (오름차순/내림차순)
   */
  private static isSequential(pin: string): boolean {
    const ascending = '01234567890';
    const descending = '09876543210';

    return ascending.includes(pin) || descending.includes(pin);
  }
}

