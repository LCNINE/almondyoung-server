'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationAdminApi,
  type NotificationEvent,
  type TemplateContents,
} from '@/lib/api/domains/notification';

const keys = {
  events: ['notification', 'events'] as const,
  templates: ['notification', 'templates'] as const,
};

export const useNotificationEvents = () =>
  useQuery({ queryKey: keys.events, queryFn: () => notificationAdminApi.getEvents() });

export const useNotificationTemplates = () =>
  useQuery({ queryKey: keys.templates, queryFn: () => notificationAdminApi.getTemplates() });

export const useUpdateNotificationEvent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventKey,
      values,
    }: {
      eventKey: string;
      values: Partial<Pick<NotificationEvent, 'isActive' | 'defaultChannels'>>;
    }) => notificationAdminApi.updateEvent(eventKey, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.events }),
  });
};

export const useUpdateTemplateContents = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, contents }: { templateId: string; contents: TemplateContents }) =>
      notificationAdminApi.updateTemplateContents(templateId, contents),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.templates }),
  });
};
