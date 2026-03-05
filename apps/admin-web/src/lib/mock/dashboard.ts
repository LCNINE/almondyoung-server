// src/lib/mock/dashboard.ts
// 대시보드 목업 데이터

export interface DashboardStat {
  label: string;
  value: string;
  change: string;
  icon: string;
}

export interface RecentOrder {
  id: string;
  order: string;
  customer: string;
  amount: string;
  status: string;
}

export interface SystemNotification {
  type: "warning" | "info" | "success" | "error";
  title: string;
  message: string;
  time: string;
}

export interface QuickAction {
  icon: string;
  label: string;
  color: string;
}

export const dashboardStats: DashboardStat[] = [
  {
    label: "오늘 주문",
    value: "567",
    change: "+12%",
    icon: "Package"
  },
  {
    label: "재고 수량",
    value: "1,234",
    change: "-3%",
    icon: "Boxes"
  },
  {
    label: "CS 대기",
    value: "23",
    change: "+5%",
    icon: "Headphones"
  },
  {
    label: "멤버십 회원",
    value: "8,901",
    change: "+8%",
    icon: "Users"
  }
];

export const recentOrders: RecentOrder[] = [
  { id: "1", order: "20250609-0000382", customer: "김철수", amount: "₩45,000", status: "처리중" },
  { id: "2", order: "20250609-0000381", customer: "이영희", amount: "₩32,000", status: "완료" },
  { id: "3", order: "20250609-0000380", customer: "박민수", amount: "₩67,000", status: "처리중" }
];

export const systemNotifications: SystemNotification[] = [
  {
    type: "warning",
    title: "재고 부족 알림",
    message: "재고 부족 상품 5개 발견",
    time: "2분 전"
  },
  {
    type: "info",
    title: "새 주문 알림",
    message: "새로운 주문 3건 접수",
    time: "5분 전"
  },
  {
    type: "success",
    title: "배송 완료",
    message: "배송 완료 12건",
    time: "10분 전"
  }
];

export const quickActions: QuickAction[] = [
  { icon: "Package", label: "주문 관리", color: "text-blue-400" },
  { icon: "Boxes", label: "재고 관리", color: "text-orange-400" },
  { icon: "Users", label: "고객 관리", color: "text-green-400" },
  { icon: "Headphones", label: "CS 관리", color: "text-purple-400" },
  { icon: "BarChart3", label: "통계", color: "text-yellow-400" },
  { icon: "Store", label: "몰 관리", color: "text-pink-400" },
  { icon: "Crown", label: "멤버십", color: "text-indigo-400" },
  { icon: "Building2", label: "거래처", color: "text-cyan-400" }
];
