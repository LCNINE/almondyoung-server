'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  dashboardStats,
  quickActions,
  recentOrders,
  systemNotifications,
} from '@/lib/mock/dashboard';
import {
  AlertCircle,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle,
  Crown,
  Headphones,
  Package,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';

const iconMap = {
  Package,
  Boxes,
  Users,
  Headphones,
  BarChart3,
  Store,
  Crown,
  Building2,
};
export default function MainTemplate() {
  return (
    <div className="space-y-6 px-4">
      {/* 대시보드 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">대시보드</h1>
          <p className="text-gray-600 mt-2">
            LCNINE 관리자 시스템에 오신 것을 환영합니다
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="w-4 h-4 mr-1" />
            시스템 정상
          </Badge>
          <Button variant="outline" size="sm">
            <TrendingUp className="w-4 h-4 mr-2" />
            실시간 현황
          </Button>
        </div>
      </div>

      {/* 주요 지표 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {dashboardStats.map((stat, index) => {
          const IconComponent = iconMap[stat.icon as keyof typeof iconMap];
          return (
            <Card
              key={index}
              className="bg-white border border-gray-200 shadow-sm"
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">
                      {stat.label}
                    </p>
                    <p className="text-2xl font-bold text-gray-900">
                      {stat.value}
                    </p>
                    <p
                      className={`text-sm ${stat.change.startsWith('+')
                          ? 'text-green-600'
                          : 'text-red-600'
                        }`}
                    >
                      {stat.change} 지난 주 대비
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-full">
                    <IconComponent className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 최근 주문 */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-gray-900">최근 주문</CardTitle>
            <CardDescription className="text-gray-600">
              최근 24시간 내 주문 현황
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentOrders.map((order, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-100 rounded-full">
                      <Package className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {order.order}
                      </p>
                      <p className="text-xs text-gray-500">{order.customer}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {order.amount}
                    </p>
                    <Badge
                      variant={
                        order.status === '완료' ? 'default' : 'secondary'
                      }
                      className="text-xs"
                    >
                      {order.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 시스템 알림 */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-gray-900">시스템 알림</CardTitle>
            <CardDescription className="text-gray-600">
              중요한 시스템 업데이트 및 알림
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {systemNotifications.map((notification, index) => (
                <div
                  key={index}
                  className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg"
                >
                  <div
                    className={`p-2 rounded-full ${notification.type === 'warning'
                        ? 'bg-yellow-100'
                        : notification.type === 'error'
                          ? 'bg-red-100'
                          : 'bg-blue-100'
                      }`}
                  >
                    <AlertCircle
                      className={`w-4 h-4 ${notification.type === 'warning'
                          ? 'text-yellow-600'
                          : notification.type === 'error'
                            ? 'text-red-600'
                            : 'text-blue-600'
                        }`}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {notification.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {notification.message}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {notification.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 빠른 액션 */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-gray-900">빠른 액션</CardTitle>
          <CardDescription className="text-gray-600">
            자주 사용하는 기능에 빠르게 접근하세요
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {quickActions.map((action, index) => {
              const IconComponent =
                iconMap[action.icon as keyof typeof iconMap];

              return (
                <Button
                  key={index}
                  variant="outline"
                  className="flex flex-col items-center space-y-2 h-20 bg-white border-gray-200 hover:bg-gray-50"
                >
                  <IconComponent className={`w-6 h-6 ${action.color}`} />
                  <span className="text-xs text-gray-700">{action.label}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
