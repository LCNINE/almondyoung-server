"use client"

import React from "react"
import MembershipTagIcon from "../../../icons/membership-tag-icon"

export const MembershipTag = ({
  isMembership,
  isSoldOut,
}: {
  isMembership: boolean
  isSoldOut: boolean
}) =>
  isMembership ? (
    <div className="inline-flex items-center">
      <MembershipTagIcon
        width={isSoldOut ? 60 : 80}
        height={isSoldOut ? 12 : 16}
        className={`${isSoldOut ? "opacity-50" : ""} md:scale-110`}
      />
    </div>
  ) : null
