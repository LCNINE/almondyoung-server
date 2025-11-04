"use client"

import React, { useState } from "react"
import { X, ShoppingCart, Plus, Minus, Trash2 } from "lucide-react"
import { Button } from "@components/common/ui/button"

interface CartItem {
  id: string
  name: string
  price: number
  quantity: number
  image: string
  options?: string
}

interface CartSheetProps {
  isOpen: boolean
  onClose: () => void
  cartItems?: CartItem[]
  onUpdateQuantity?: (id: string, quantity: number) => void
  onRemoveItem?: (id: string) => void
}

// TODO: 실제 장바구니 데이터 연동

const CartSheet: React.FC<CartSheetProps> = ({
  isOpen,
  onClose,
  cartItems = [],
  onUpdateQuantity,
  onRemoveItem
}) => {
  const [items, setItems] = useState<CartItem[]>(cartItems)

  const handleQuantityChange = (id: string, newQuantity: number) => {
    if (newQuantity < 1) return
    
    setItems(prev => 
      prev.map(item => 
        item.id === id ? { ...item, quantity: newQuantity } : item
      )
    )
    onUpdateQuantity?.(id, newQuantity)
  }

  const handleRemoveItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
    onRemoveItem?.(id)
  }

  const totalPrice = items.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div 
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`} 
      onClick={onClose}
    >
      <div 
        className={`absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl transform transition-all duration-500 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-bold">장바구니</h2>
            <span className="rounded-full bg-orange-500 px-2 py-1 text-xs text-white">
              {totalItems}
            </span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <ShoppingCart className="h-12 w-12 mb-4 text-gray-300" />
              <p className="text-sm">장바구니가 비어있습니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-lg border border-gray-200 p-3">
                  {/* Product Image */}
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                    <img 
                      src={item.image} 
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  
                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 line-clamp-2">
                      {item.name}
                    </h3>
                    {item.options && (
                      <p className="text-xs text-gray-500 mt-1">{item.options}</p>
                    )}
                    <p className="text-sm font-bold text-gray-900 mt-1">
                      {item.price.toLocaleString()}원
                    </p>
                    
                    {/* Quantity Controls */}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 hover:bg-gray-50"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm font-medium w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 hover:bg-gray-50"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="ml-auto p-1 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-gray-20 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">총 {totalItems}개 상품</span>
              <span className="text-lg font-bold text-gray-900">
                {totalPrice.toLocaleString()}원
              </span>
            </div>
            <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white">
              장바구니로 이동
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default CartSheet
