import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AttendanceRequest } from '@packages/domain-types/attendance';
import { AttendanceRequestReview } from './request-review';

it.each(['강유진', undefined])(
  'opens a compact pending inbox even without a staff name (%s)',
  (name) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const request: AttendanceRequest = {
      id: 'pending-request',
      userId: 'owner',
      name,
      workDate: '2026-10-19',
      sessionId: 'session',
      targetVersion: 1,
      checkIn: '2026-10-19T00:00:00Z',
      checkOut: null,
      reason: '출근 기록이 누락됐어요.',
      fileIds: [],
      status: 'pending',
      version: 1,
      decisionReason: null,
      createdAt: '2026-10-19T01:00:00Z',
      aiStatus: 'pending',
      original: { checkIn: '2026-10-19T00:12:00Z', checkOut: null, version: 1 },
    };

    client.setQueryData(['attendance', 'me'], {
      userId: 'owner',
      isMaster: true,
    });
    client.setQueryData(
      ['attendance', 'requests', true],
      [
        request,
        {
          ...request,
          id: 'finished-request',
          name: '완료된 직원',
          status: 'rejected',
          aiResult: {
            summary: '목록에서 숨길 AI 내용',
            questions: [],
            evidence: [],
            opinion: 'reviewable',
          },
        },
      ]
    );

    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(AttendanceRequestReview, { showHeading: false })
        )
      );

      expect(html).toContain('검토 대기');
      expect(html).toContain('보완 대기');
      expect(html).toContain('처리 완료');
      expect(html).toContain(name ?? '직원');
      expect(html).toContain('오전 9:12');
      expect(html).toContain('오전 9:00');
      expect(html).not.toContain('완료된 직원');
      expect(html).not.toContain('목록에서 숨길 AI 내용');
      expect(html).not.toContain('처리 사유');
      expect(html).not.toContain('승인하고 기록 반영');
    } finally {
      client.clear();
    }
  }
);
