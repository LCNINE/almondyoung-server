import React from 'react'
import Image from 'next/image'
import Link from 'next/link'

interface MembershipBannerProps {
  className?: string
}

export const MembershipBanner: React.FC<MembershipBannerProps> = ({ 
  className = "" 
}) => {
  return (
    <div className={`relative w-full h-32 md:h-[150px] overflow-hidden ${className}`}>
      <Link href="/auth/signup" className="block w-full h-full">
        <Image
          src="/images/banner/membership_banner.png"
          alt="아몬드영 멤버십 가입하고 추가혜택 받으세요!"
          fill
          className="object-cover transition-transform duration-300 hover:scale-105"
          priority
        />
        <div className="absolute inset-0 bg-black/10 hover:bg-black/20 transition-colors duration-300" />
        
        {/* 오버레이 텍스트 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <div className="mb-2">
            <span className="inline-flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-semibold text-gray-800">
              멤버십 할인가
            </span>
          </div>
          <h3 className="text-white text-lg md:text-3xl font-bold ">
            아몬드영 멤버십 가입하고 추가혜택 받으세요!
          </h3>
        </div>
      </Link>
    </div>
  )
}

export default MembershipBanner
