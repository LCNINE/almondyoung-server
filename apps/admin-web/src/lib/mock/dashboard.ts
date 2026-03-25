export const dashboardStats = [
  { label: '총 주문', value: '0', change: '+0%', icon: 'Package' },
  { label: '재고 항목', value: '0', change: '+0%', icon: 'Boxes' },
  { label: '회원 수', value: '0', change: '+0%', icon: 'Users' },
  { label: '문의 건수', value: '0', change: '+0%', icon: 'Headphones' },
];

export const quickActions = [
  { label: '통계', icon: 'BarChart3', color: 'text-blue-600' },
  { label: '판매처', icon: 'Store', color: 'text-green-600' },
  { label: '멤버십', icon: 'Crown', color: 'text-yellow-600' },
  { label: '파트너사', icon: 'Building2', color: 'text-purple-600' },
];

export const recentOrders: {
  order: string;
  customer: string;
  amount: string;
  status: string;
}[] = [];

export const systemNotifications: {
  title: string;
  message: string;
  time: string;
  type: 'info' | 'warning' | 'error';
}[] = [];
