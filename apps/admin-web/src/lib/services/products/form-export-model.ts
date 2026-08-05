// src/lib/services/products/form-export-model.ts
// 양식 생성 목록의 판정 로직. admin-web 은 컴포넌트 테스트가 불가능하므로(렌더러 없음)
// 화면이 쓰는 판정은 전부 여기 순수 함수로 두고 spec 으로 잠근다.

import type { FormExportList, FormExportSummary } from '@/lib/types/dto/form-export';

/** 서버의 MAX_CONSECUTIVE_EXPORT_FAILURES 와 같은 값. 문구에만 쓴다. */
const MAX_FAILURES = 3;

export interface FormExportRowState {
  label: string;
  tone: 'pending' | 'progress' | 'error' | 'done';
  action: 'none' | 'download' | 'retry';
}

/**
 * 진행 중 항목이 하나라도 있으면 계속 두드린다. 데이터가 아직 없을 때(초기 로드·일시적
 * 5xx)도 두드린다 — 여기서 멈추면 화면이 마운트 내내 굳는다(formExportRefetchInterval
 * 이 같은 이유로 그렇게 돼 있었다).
 */
export function formExportListRefetchInterval(list: FormExportList | undefined): number | false {
  if (!list) return 5000;
  const running = list.data.some((item) => item.status === 'queued' || item.status === 'running');
  return running ? 5000 : false;
}

/**
 * 행 하나의 표시·액션을 정한다.
 *
 * 서버는 실패해도 상태를 running 으로 두고 consecutiveFailures 만 올린다(상한에 닿아야
 * failed). 그래서 "생성 중"과 "재시도 대기 중"은 status 가 아니라 이 카운터로 갈린다 —
 * 이 구분이 없으면 사용자는 실패를 진행 중으로 오해한 채 기다린다.
 */
export function formExportRowState(item: FormExportSummary): FormExportRowState {
  if (item.status === 'failed') {
    return { label: '실패', tone: 'error', action: 'retry' };
  }
  if (item.status === 'completed') {
    return item.downloadable
      ? { label: '완료', tone: 'done', action: 'download' }
      : { label: '완료 (파일 없음)', tone: 'error', action: 'none' };
  }
  if (item.status === 'running') {
    return item.consecutiveFailures > 0
      ? {
          label: `재시도 대기 중 (${item.consecutiveFailures}/${MAX_FAILURES})`,
          tone: 'error',
          action: 'none',
        }
      : { label: '생성 중', tone: 'progress', action: 'none' };
  }
  return { label: '대기 중', tone: 'pending', action: 'none' };
}
