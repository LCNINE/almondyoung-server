// 와우프레스 작업상태(JobStat) 파일 에러를 고객이 알아들을 말로 옮긴다. 알림톡 변수는 14자까지라 짧게 둔다
const PRINT_FILE_REJECTION_REASONS: Record<number, string> = {
  121: '그룹 처리 누락',
  122: '테두리선 남음',
  123: '글자 윤곽선 미처리',
  124: '프로그램 버전 오류',
  125: '칼선 없음',
  126: '파일 내용 누락',
  127: '크기 불일치',
  129: '앞·뒷면 구성 오류',
  130: '이미지 누락',
  131: '파일 오류',
};

export function printFileRejectionReason(jobstat: number): string {
  return PRINT_FILE_REJECTION_REASONS[jobstat] ?? '파일 오류';
}
