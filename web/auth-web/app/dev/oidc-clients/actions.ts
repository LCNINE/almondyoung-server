"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import {
  clearPreviousOAuthClientSecret,
  createOAuthClient,
  deactivateOAuthClient,
  rotateOAuthClientSecret,
  updateOAuthClient,
  type CreateOAuthClientInput,
  type OAuthClient,
  type OAuthClientWithSecret,
  type UpdateOAuthClientInput,
} from "@/lib/user-service-admin";
import { requireDefaultSite } from "@/lib/site/site";

const PATH = "/dev/oidc-clients";

async function ensureEnabled() {
  if (!env.devToolsEnabled) notFound();
  await requireDefaultSite();
}

export async function createClientAction(
  input: CreateOAuthClientInput,
): Promise<OAuthClientWithSecret> {
  await ensureEnabled();
  const result = await createOAuthClient(input);
  revalidatePath(PATH);
  return result;
}

export async function updateClientAction(
  clientId: string,
  patch: UpdateOAuthClientInput,
): Promise<OAuthClient> {
  await ensureEnabled();
  const result = await updateOAuthClient(clientId, patch);
  revalidatePath(PATH);
  return result;
}

export async function rotateSecretAction(clientId: string): Promise<OAuthClientWithSecret> {
  await ensureEnabled();
  const result = await rotateOAuthClientSecret(clientId);
  revalidatePath(PATH);
  return result;
}

export async function clearPreviousSecretAction(clientId: string): Promise<OAuthClient> {
  await ensureEnabled();
  const result = await clearPreviousOAuthClientSecret(clientId);
  revalidatePath(PATH);
  return result;
}

export async function deactivateClientAction(clientId: string): Promise<OAuthClient> {
  await ensureEnabled();
  const result = await deactivateOAuthClient(clientId);
  revalidatePath(PATH);
  return result;
}
