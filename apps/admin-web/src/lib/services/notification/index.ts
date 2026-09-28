'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailLayoutSettings } from '@packages/email-layout';
import { notificationAdminApi, type NotificationEvent, type TemplateContents } from '@/lib/api/domains/notification';

const keys = {
  events: ['notification', 'events'] as const,
  templates: ['notification', 'templates'] as const,
  emailLayout: ['notification', 'email-layout'] as const,
};

export const useNotificationEvents = () =>
  useQuery({
    queryKey: keys.events,
    queryFn: () => notificationAdminApi.getEvents(),
  });

export const useNotificationTemplates = () =>
  useQuery({
    queryKey: keys.templates,
    queryFn: () => notificationAdminApi.getTemplates(),
  });

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

export const useEmailLayout = () =>
  useQuery({
    queryKey: keys.emailLayout,
    queryFn: () => notificationAdminApi.getEmailLayout(),
  });

export const useUpdateEmailLayout = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<EmailLayoutSettings>) => notificationAdminApi.updateEmailLayout(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.emailLayout }),
  });
};

export const useResetTemplateToDefault = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => notificationAdminApi.resetTemplateToDefault(templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.templates }),
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
