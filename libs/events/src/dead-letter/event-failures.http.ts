import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 종결 요청 본문 (스펙 §7.5·§8.4). 컨트롤러는 앱이 선언하지만 본문 모양은 같아야 한다 */
export class DiscardFailureDto {
  @ApiProperty({ description: '종결 사유', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** JWT 사용자에서 조치자 id. core·channel-adapter 의 `@User()` 모양이 같지 않아 셋을 차례로 본다 */
export function actorIdOf(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  // unknown 을 좁히는 한 곳 — 세 필드 모두 아래에서 string 인지 다시 확인한다
  const candidate = user as { id?: unknown; userId?: unknown; sub?: unknown };
  const value = candidate.id ?? candidate.userId ?? candidate.sub;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
