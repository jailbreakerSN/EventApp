import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <p
          aria-hidden="true"
          className="font-serif-display text-[96px] font-semibold leading-none tracking-[-0.04em] text-teranga-navy/85 dark:text-teranga-gold"
        >
          404
        </p>
        <EmptyStateEditorial
          className="mt-4"
          icon={SearchX}
          kicker="— PAGE INTROUVABLE"
          title="Cette page n’existe plus"
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
