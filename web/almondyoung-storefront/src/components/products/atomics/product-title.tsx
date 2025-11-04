"use client"

import React from "react"

export const ProductTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="line-clamp-2 text-[15px] md:text-base lg:text-lg font-normal leading-[1.36] md:leading-[1.19] tracking-[-0.02em] flex-1">
    {children}
  </h3>
)
