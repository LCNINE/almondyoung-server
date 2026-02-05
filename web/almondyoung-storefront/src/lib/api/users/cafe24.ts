"use server"

import { api } from "@lib/api/api"

export type Cafe24MigrationKey = "email" | "name" | "birthday" | "phone"
export type Cafe24MigrationStatus = "synced" | "out_of_sync" | "missing"

export interface Cafe24LinkResult {
  linkId: string
  mallId: string | null
  cafe24MemberId: string | null
  linkedAt: string
}

export interface Cafe24MigrationItem {
  key: Cafe24MigrationKey
  status: Cafe24MigrationStatus
  cafe24Value: string | null
  userValue: string | null
}

export async function linkCafe24(cafe24_link_token: string) {
  return await api<Cafe24LinkResult>("users", "/cafe24/link", {
    method: "POST",
    body: { cafe24_link_token },
    withAuth: true,
  })
}

export async function getCafe24Migration() {
  return await api<Cafe24MigrationItem[]>("users", "/cafe24/migration", {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })
}

export async function getCafe24MigrationItem(key: Cafe24MigrationKey) {
  return await api<Cafe24MigrationItem>("users", `/cafe24/migration/${key}`, {
    method: "GET",
    withAuth: true,
    cache: "no-store",
  })
}

export async function migrateCafe24Item(key: Cafe24MigrationKey) {
  return await api<Cafe24MigrationItem>("users", `/cafe24/migration/${key}`, {
    method: "POST",
    withAuth: true,
  })
}
