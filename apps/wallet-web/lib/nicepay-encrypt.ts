import { createCipheriv } from 'crypto';

export function encryptNicepayCardData(
  cardNo: string,
  expYear: string,
  expMonth: string,
  idNo: string,
  cardPw: string,
  secretKey: string,
  encMode?: string,
): string {
  const plaintext = `cardNo=${cardNo}&expYear=${expYear}&expMonth=${expMonth}&idNo=${idNo}&cardPw=${cardPw}`;

  if (encMode === 'A2') {
    // AES-256/CBC, IV = SecretKey 앞 16자
    const key = Buffer.from(secretKey.slice(0, 32), 'utf8');
    const iv = Buffer.from(secretKey.slice(0, 16), 'utf8');
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
  }

  // AES-128/ECB (기본), key = SecretKey 앞 16자
  const key = Buffer.from(secretKey.slice(0, 16), 'utf8');
  const cipher = createCipheriv('aes-128-ecb', key, Buffer.alloc(0));
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
}
