'use client'

import React from 'react'
import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  message?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const LoadingState: React.FC<LoadingStateProps> = ({
  message = '로딩 중...',
  className = '',
  size = 'md'
}) => {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'h-6 w-6'
      case 'lg':
        return 'h-12 w-12'
      default:
        return 'h-8 w-8'
    }
  }

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`}>
      <Loader2 className={`${getSizeClasses()} animate-spin text-blue-500 mb-4`} />
      <p className="text-gray-600">{message}</p>
    </div>
  )
}

export default LoadingState
