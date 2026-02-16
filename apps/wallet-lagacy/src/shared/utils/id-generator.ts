import { v7 as uuidv7 } from 'uuid'; // uuid v7 지원 라이브러리 사용

export function generateUUIDv7(): string {
  return uuidv7();
}
