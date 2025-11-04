'use client'

import React from 'react'
import { Button } from '../ui/button'
import { AlertCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react'

interface ErrorStateProps {
  title?: string
  message?: string
  errorType?: 'NETWORK_ERROR' | 'TIMEOUT_ERROR' | 'SERVER_ERROR' | 'CLIENT_ERROR' | 'UNKNOWN_ERROR'
  onRetry?: () => void
  isLoading?: boolean
  className?: string
}

const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  message,
  errorType = 'UNKNOWN_ERROR',
  onRetry,
  isLoading = false,
  className = ''
}) => {
  const getErrorIcon = () => {
    switch (errorType) {
      case 'NETWORK_ERROR':
        return <WifiOff className="h-16 w-16 text-red-500" />
      case 'TIMEOUT_ERROR':
        return <Wifi className="h-16 w-16 text-orange-500" />
      case 'SERVER_ERROR':
        return <AlertCircle className="h-16 w-16 text-red-500" />
      case 'CLIENT_ERROR':
        return <AlertCircle className="h-16 w-16 text-yellow-500" />
      default:
        return <AlertCircle className="h-16 w-16 text-gray-500" />
    }
  }

  const getErrorTitle = () => {
    if (title) return title
    
    switch (errorType) {
      case 'NETWORK_ERROR':
        return '연결 오류'
      case 'TIMEOUT_ERROR':
        return '요청 시간 초과'
      case 'SERVER_ERROR':
        return '서버 오류'
      case 'CLIENT_ERROR':
        return '요청 오류'
      default:
        return '오류가 발생했습니다'
    }
  }

  const getErrorMessage = () => {
    if (message) return message
    
    switch (errorType) {
      case 'NETWORK_ERROR':
        return '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해주세요.'
      case 'TIMEOUT_ERROR':
        return '요청 시간이 초과되었습니다. 네트워크 상태를 확인하고 다시 시도해주세요.'
      case 'SERVER_ERROR':
        return '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
      case 'CLIENT_ERROR':
        return '요청을 처리할 수 없습니다. 입력 정보를 확인해주세요.'
      default:
        return '예상치 못한 오류가 발생했습니다. 페이지를 새로고침하고 다시 시도해주세요.'
    }
  }

  const getRetryButtonText = () => {
    switch (errorType) {
      case 'NETWORK_ERROR':
        return '다시 연결'
      case 'TIMEOUT_ERROR':
        return '다시 시도'
      case 'SERVER_ERROR':
        return '새로고침'
      case 'CLIENT_ERROR':
        return '확인'
      default:
        return '다시 시도'
    }
  }

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`}>
      <div className="mb-6">
        {getErrorIcon()}
      </div>
      
      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        {getErrorTitle()}
      </h2>
      
      <p className="text-gray-600 mb-8 max-w-md">
        {getErrorMessage()}
      </p>
      
      {onRetry && (
        <Button
          onClick={onRetry}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          {isLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isLoading ? '처리 중...' : getRetryButtonText()}
        </Button>
      )}
    </div>
  )
}

export default ErrorState
