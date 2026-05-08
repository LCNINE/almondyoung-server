"use client";

import { useState } from "react";

import type { OAuthClient, OAuthClientWithSecret } from "@/lib/user-service-admin";

import { ClientsTable } from "./clients-table";
import { CreateClientForm } from "./create-client-form";
import { EditClientDialog } from "./edit-client-dialog";
import { SecretRevealDialog, type SecretRevealPayload } from "./secret-reveal-dialog";

type Props = {
  initialClients: OAuthClient[];
};

export function DevOidcClientsClient({ initialClients }: Props) {
  const [secretReveal, setSecretReveal] = useState<SecretRevealPayload | null>(null);
  const [editing, setEditing] = useState<OAuthClient | null>(null);

  const handleCreated = (created: OAuthClientWithSecret) => {
    setSecretReveal({
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      context: "created",
    });
  };

  const handleRotated = (rotated: OAuthClientWithSecret) => {
    setSecretReveal({
      clientId: rotated.clientId,
      clientSecret: rotated.clientSecret,
      context: "rotated",
    });
  };

  return (
    <div className="space-y-8">
      <CreateClientForm onCreated={handleCreated} />
      <ClientsTable
        clients={initialClients}
        onEdit={setEditing}
        onSecretRevealed={handleRotated}
      />
      <SecretRevealDialog payload={secretReveal} onClose={() => setSecretReveal(null)} />
      <EditClientDialog
        key={editing?.clientId ?? "none"}
        client={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
