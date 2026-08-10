import type { Filter } from '@/components/data-table';

export function useSitePopupsTableFilters(): Filter[] {
  return [
    {
      key: 'isActive',
      label: '노출 사용',
      type: 'select',
      options: [
        { label: '사용', value: 'true' },
        { label: '미사용', value: 'false' },
      ],
    },
    {
      key: 'placement',
      label: '노출 위치',
      type: 'select',
      options: [
        { label: '메인 페이지만', value: 'main' },
        { label: '전체 페이지', value: 'all' },
        { label: '지정한 경로', value: 'paths' },
      ],
    },
    {
      key: 'audience',
      label: '노출 대상',
      type: 'select',
      options: [
        { label: '전체', value: 'all' },
        { label: '비로그인 방문자', value: 'guest' },
        { label: '로그인 회원', value: 'member' },
        { label: '멤버십 회원', value: 'membership' },
      ],
    },
    {
      key: 'q',
      label: '제목',
      type: 'string',
    },
  ];
}
