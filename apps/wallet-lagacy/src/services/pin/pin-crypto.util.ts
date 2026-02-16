import * as bcrypt from 'bcrypt';

/**
 * PIN 암호화 유틸리티
 *
 * bcrypt를 사용한 단방향 해시 암호화
 */
export class PinCryptoUtil {
  private static readonly SALT_ROUNDS = 10;

  /**
   * PIN을 해시화합니다.
   * @param pin 평문 PIN (6자리 숫자)
   * @returns 해시된 PIN
   */
  static async hash(pin: string): Promise<string> {
    return await bcrypt.hash(pin, this.SALT_ROUNDS);
  }

  /**
   * 입력된 PIN과 해시를 비교합니다.
   * @param inputPin 입력된 평문 PIN
   * @param hash 저장된 해시값
   * @returns 일치 여부
   */
  static async compare(inputPin: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(inputPin, hash);
  }
}
