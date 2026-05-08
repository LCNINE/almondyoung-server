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

const PATH = "/dev/oidc-clients";

function ensureEnabled() {
  if (!env.devToolsEnabled) notFound();
}

export async function createClientAction(
  input: CreateOAuthClientInput,
): Promise<OAuthClientWithSecret> {
  ensureEnabled();
  const result = await createOAuthClient(input);
  revalidatePath(PATH);
  return result;
}

export async function updateClientAction(
  clientId: string,
  patch: UpdateOAuthClientInput,
): Promise<OAuthClient> {
  ensureEnabled();
  const result = await updateOAuthClient(clientId, patch);
  revalidatePath(PATH);
  return result;
}

export async function rotateSecretAction(clientId: string): Promise<OAuthClientWithSecret> {
  ensureEnabled();
  const result = await rotateOAuthClientSecret(clientId);
  revalidatePath(PATH);
  return result;
}

export async function clearPreviousSecretAction(clientId: string): Promise<OAuthClient> {
  ensureEnabled();
  const result = await clearPreviousOAuthClientSecret(clientId);
  revalidatePath(PATH);
  return result;
}

export async function deactivateClientAction(clientId: string): Promise<OAuthClient> {
  ensureEnabled();
  const result = await deactivateOAuthClient(clientId);
  revalidatePath(PATH);
  return result;
}
