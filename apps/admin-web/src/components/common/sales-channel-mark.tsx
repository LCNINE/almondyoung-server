/** @format */

'use client';

import React from 'react';
import Image from 'next/image';
import type { ChannelDto } from '@/lib/types/dto/products';

export type SalesChannelType = 'almondyoung' | 'coupang' | 'naver_smartstore' | 'phone_order' | 'other';

export interface SalesChannelMarkProps {
    channel: SalesChannelType;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const channelConfig = {
    almondyoung: '/icons/almondyoung_mark.png',
    coupang: '/icons/coupang_mark.png',
    naver_smartstore: '/icons/smartstore_mark.png', // naver를 naver_smartstore로 변경
    phone_order: '/icons/phone_order_mark.png',
    other: '/icons/other_mark.png',
};

const sizeConfig = {
    sm: { width: 120, height: 40 }, // 더 큰 크기로 변경
    md: { width: 150, height: 50 },
    lg: { width: 180, height: 60 },
};

export function SalesChannelMark({
    channel,
    size = 'md',
    className,
}: SalesChannelMarkProps) {
    const imageSrc = channelConfig[channel];
    const dimensions = sizeConfig[size];

    if (!imageSrc) {
        console.warn(`Unknown sales channel: ${channel}`);
        return <span className="text-red-500">Unknown</span>;
    }

    return (
        <div className="flex justify-center items-center">
            <Image
                src={imageSrc}
                alt={`${channel} 마크`}
                width={dimensions.width}
                height={dimensions.height}
                className={className}
            />
        </div>
    );
}

// 판매처별 아이콘만 표시하는 컴포넌트
export function SalesChannelIcon({
    channel,
    size = 'md',
    className,
}: Omit<SalesChannelMarkProps, 'showText'>) {
    return (
        <SalesChannelMark
            channel={channel}
            size={size}
            className={className}
        />
    );
}

// 판매처별 텍스트만 표시하는 컴포넌트
export function SalesChannelText({
    channel,
    size = 'md',
    className,
}: Omit<SalesChannelMarkProps, 'showText'>) {
    const channelNameMap: Record<SalesChannelType, string> = {
        almondyoung: '아몬드영',
        coupang: '쿠팡',
        naver_smartstore: '네이버 스마트스토어',
        phone_order: '전화주문',
        other: '기타',
    };

    return (
        <span className={className}>
            {channelNameMap[channel] || channel}
        </span>
    );
}

// PIM API 채널 데이터를 사용하는 컴포넌트
export interface PimChannelMarkProps {
    channel: ChannelDto;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    showText?: boolean;
}

export function PimChannelMark({
    channel,
    size = 'md',
    className,
    showText = false,
}: PimChannelMarkProps) {
    // 채널 이름을 기반으로 SalesChannelType 결정
    const getChannelType = (channelName: string): SalesChannelType => {
        const name = channelName.toLowerCase();

        if (name.includes('아몬드영') || name.includes('almondyoung') || name.includes('공식')) {
            return 'almondyoung';
        }
        if (name.includes('쿠팡') || name.includes('coupang')) {
            return 'coupang';
        }
        if (name.includes('네이버') || name.includes('naver') || name.includes('스마트스토어') || name.includes('smartstore')) {
            return 'naver_smartstore';
        }
        if (name.includes('전화') || name.includes('phone') || name.includes('직접')) {
            return 'phone_order';
        }

        return 'other';
    };

    const channelType = getChannelType(channel.name);

    return (
        <div className="flex items-center gap-2">
            <SalesChannelMark
                channel={channelType}
                size={size}
                className={className}
            />
            {showText && (
                <span className="text-sm text-gray-600">
                    {channel.name}
                </span>
            )}
        </div>
    );
}

// 채널 ID를 기반으로 채널 마크를 표시하는 컴포넌트
export interface ChannelMarkByIdProps {
    channelId: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    showText?: boolean;
}

export function ChannelMarkById({
    channelId,
    size = 'md',
    className,
    showText = false,
}: ChannelMarkByIdProps) {
    // 실제로는 useChannel 훅을 사용해서 채널 데이터를 가져와야 함
    // 여기서는 예시로 간단한 구현만 제공
    const channelNameMap: Record<string, SalesChannelType> = {
        'channel-001': 'almondyoung',
        'channel-002': 'coupang',
        'channel-003': 'naver_smartstore',
        'channel-004': 'phone_order',
    };

    const channelType = channelNameMap[channelId] || 'other';

    return (
        <SalesChannelMark
            channel={channelType}
            size={size}
            className={className}
        />
    );
} 