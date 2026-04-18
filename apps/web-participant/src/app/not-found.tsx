import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <EmptyStateEditorial
          icon={SearchX}
          kicker="— 404"
          title="Page introuvable"
          description="La page que vous recherchez n’existe pas ou a été déplacée."
          action={
            <Link href="/events">
              <Button>Retour aux événements</Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}
