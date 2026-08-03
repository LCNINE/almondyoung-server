import { ApiProperty } from '@nestjs/swagger';

/**
 * 화면 단계 키. 워커 **레인**과 1:1 이 아니다 — 레인은 claim·lease·굶주림의 단위고
 * 단계는 사람이 이해하는 단위다. 이미지 레인 하나가 'probe'·'fetch' 두 단계로 갈린다
 * (스펙 §3.5). 화면은 이 배열을 순회해 그리고, 단계 개수를 코드에 박지 않는다.
 */
export type ImportProgressStageKey = 'probe' | 'fetch' | 'commit' | 'publish';

export class ImportProgressStageDto {
  @ApiProperty({ enum: ['probe', 'fetch', 'commit', 'publish'] })
  key: ImportProgressStageKey;

  @ApiProperty({ description: '관리자 화면에 그대로 노출되는 단계 이름' })
  label: string;

  @ApiProperty({ enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'] })
  status: string;

  @ApiProperty({ description: '처리가 끝난 행 수(성공 + 실패)' })
  done: number;

  @ApiProperty({ description: '이 단계의 분모. 0 이면 화면이 단계를 접는다.' })
  total: number;

  @ApiProperty({ description: 'done 에 포함돼 있는 실패 행 수' })
  failed: number;

  @ApiProperty({ required: false, nullable: true, description: '해당 레인의 잡 오류 메시지' })
  error: string | null;
}

export class ImportProgressDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '행 목록을 안 불러도 화면 상단을 그릴 수 있게 함께 싣는다.',
  })
  fileName: string | null;

  @ApiProperty({ description: '취소된 세션이면 true. 남은 단계는 더 나아가지 않는다.' })
  canceled: boolean;

  @ApiProperty({ required: false, nullable: true })
  cancelRequestedAt: Date | null;

  @ApiProperty({ description: '워크북 전체 행 수(접수 시점 검증실패 포함)' })
  totalRows: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '접수 시점 검증실패 행 수. v3 1단계 이전 세션은 null 이다.',
  })
  invalidCount: number | null;

  @ApiProperty({ type: [ImportProgressStageDto] })
  stages: ImportProgressStageDto[];
}
