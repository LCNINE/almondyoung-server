import { Badge } from '@/components/ui/badge';
import type { NotificationChannel } from '@/lib/api/domains/notification';

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: '메일',
  KAKAO: '알림톡',
  SMS: 'SMS',
  PUSH: '앱 푸시',
};

export function ChannelBadges({ channels }: { channels: NotificationChannel[] }) {
  return (
    <div className="flex gap-1">
      {channels.map((channel) => (
        <Badge key={channel} variant="secondary" className="font-normal">
          {CHANNEL_LABEL[channel]}
        </Badge>
      ))}
    </div>
  );
}
