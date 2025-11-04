"use client"

import React from "react"

export const ProductShipment = ({ info }: { info?: string }) =>
  info ? <div className="text-xs font-medium text-gray-500">{info}</div> : null
