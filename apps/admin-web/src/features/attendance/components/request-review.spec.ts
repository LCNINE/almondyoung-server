import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AttendanceRequest } from '@packages/domain-types/attendance';
import { AttendanceRequestReview } from './request-review';
import {
  ATTENDANCE_MANAGER_PERMISSIONS,
  failPermissionsRefetch,
  seedPermissions,
} from '../testing/seed-permissions';

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
      // 옛 표식은 반대로 둔다 — 화면은 권한만 본다.
      isMaster: false,
    });
    seedPermissions(client, ATTENDANCE_MANAGER_PERMISSIONS);
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

it.each(['denied', 'refetch failed'] as const)(
  'stops drawing cached requests when the review permission is not confirmed (%s)',
  async (state) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, retryOnMount: false, gcTime: Infinity },
      },
    });

    // 옛 표식이 열어 주더라도 권한이 확인되지 않으면 검토 화면을 그리지 않는다.
    client.setQueryData(['attendance', 'me'], {
      userId: 'owner',
      isMaster: true,
    });
    client.setQueryData(
      ['attendance', 'requests', true],
      [
        {
          id: 'cached',
          userId: 'owner',
          name: '캐시된 직원',
          status: 'pending',
        },
      ]
    );

    if (state === 'denied') {
      seedPermissions(client, ['attendance.own.write']);
    } else {
      await failPermissionsRefetch(client, ATTENDANCE_MANAGER_PERMISSIONS);
    }

    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(AttendanceRequestReview, { showHeading: false })
        )
      );

      expect(html).not.toContain('캐시된 직원');
      expect(html).toContain(
        state === 'denied'
          ? '검토할 권한이 없어요'
          : '권한 정보를 불러오지 못했어요'
      );
    } finally {
      client.clear();
    }
  }
);
