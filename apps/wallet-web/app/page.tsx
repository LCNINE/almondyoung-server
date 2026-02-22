import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Wallet Web</CardTitle>
          <CardDescription>
            Hosted checkout and developer utilities for wallet integration.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/dev/intents">Open Dev Intent Explorer</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dev/api">Open Dev API Console</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
