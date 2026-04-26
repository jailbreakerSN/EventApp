"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * Templates picker — 8 starter templates as a card grid. Click a
 * card → a small inline form on the right ("Title + Start date +
 * Venue") materialises the event via `cloneFromTemplate` and
 * navigates the operator to the new event's overview.
 *
 * UX:
 *  - 2-column responsive grid (1 col on mobile).
 *  - Selected card sticks to the top of the right panel — the form
 *    is inline rather than a modal so the operator sees the picker
 *    while typing the title.
 *  - Loading skeletons for the catalog (~200 ms typical).
 *  - Error banner on clone failure (e.g. plan limit hit).
 *  - "Configurer manuellement" fallback link in the header for users
 *    who want the existing 4-step wizard.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  FormField,
  InlineErrorBanner,
  Input,
  Skeleton,
} from "@teranga/shared-ui";
import { useAuth } from "@/hooks/use-auth";
import { useCloneFromTemplate, useEventTemplates } from "@/hooks/use-event-templates";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import { TemplateCard } from "@/components/templates/TemplateCard";
import { cn } from "@/lib/utils";
import type { EventTemplate } from "@teranga/shared-types";

export default function EventTemplatesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: templates, isLoading } = useEventTemplates();
  const clone = useCloneFromTemplate();
  const { resolve: resolveError } = useErrorHandler();

  const [selected, setSelected] = useState<EventTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<ResolvedError | null>(null);

  const handleSelect = (t: EventTemplate) => {
    setSelected(t);
    setTitle((current) => current || t.label);
    setValidationError(null);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setError(null);
    if (!selected) {
      setValidationError("Sélectionnez un modèle pour démarrer.");
      return;
    }
    if (title.trim().length < 3) {
      setValidationError("Le titre doit contenir au moins 3 caractères.");
      return;
    }
    if (!startDate) {
      setValidationError("Choisissez une date de début.");
      return;
    }
    if (!user?.organizationId) {
      setValidationError("Aucune organisation associée à votre compte.");
      return;
    }
    try {
      // Convert datetime-local → ISO. The browser ships local time so
      // we add the offset to keep UTC semantics correct.
      const startIso = new Date(startDate).toISOString();
      const result = await clone.mutateAsync({
        templateId: selected.id,
        title: title.trim(),
        startDate: startIso,
        organizationId: user.organizationId,
        ...(venueName.trim() ? { venueName: venueName.trim() } : {}),
      });
      router.push(`/events/${result.event.id}/overview`);
    } catch (err) {
      setError(resolveError(err));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
            Démarrer depuis un modèle
          </h1>
          <p className="text-sm text-muted-foreground">
            Tickets, sessions et rappels pré-configurés. Vous gardez la main sur tout après le clic.
          </p>
        </div>
        <Link
          href="/events/new"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Configurer manuellement
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr,360px]">
        {/* Card grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} variant="rectangle" className="h-44" />
              ))
            : (templates ?? []).map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  selected={selected?.id === t.id}
                  onSelect={() => handleSelect(t)}
                />
              ))}
        </div>

        {/* Right panel — clone form */}
        <aside className={cn("lg:sticky lg:top-4 lg:self-start space-y-3")}>
          <Card>
            <CardContent className="p-5 space-y-3">
              <h2 className="text-sm font-semibold">Configurer le nouvel événement</h2>
              {!selected ? (
                <p className="text-xs text-muted-foreground">
                  Sélectionnez un modèle pour activer le formulaire.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Modèle : <span className="font-medium text-foreground">{selected.label}</span>
                </p>
              )}

              {validationError && (
                <InlineErrorBanner
                  severity="warning"
                  title="Champ manquant"
                  description={validationError}
                  onDismiss={() => setValidationError(null)}
                  dismissLabel="Fermer"
                />
              )}
              {error && (
                <InlineErrorBanner
                  title={error.title}
                  description={error.description}
                  onDismiss={() => setError(null)}
                  dismissLabel="Fermer"
                />
              )}

              <form onSubmit={submit} className="space-y-3">
                <FormField label="Titre de l'événement" htmlFor="template-title">
                  <Input
                    id="template-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    disabled={!selected}
                    placeholder="Mon événement Teranga"
                  />
                </FormField>

                <FormField label="Date & heure de début" htmlFor="template-start">
                  <Input
                    id="template-start"
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={!selected}
                    required
                  />
                </FormField>

                <FormField label="Lieu (optionnel)" htmlFor="template-venue">
                  <Input
                    id="template-venue"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    maxLength={200}
                    disabled={!selected}
                    placeholder="Salle Léopold Sédar Senghor"
                  />
                </FormField>

                <Button type="submit" className="w-full" disabled={!selected || clone.isPending}>
                  {clone.isPending ? "Création…" : "Créer l'événement"}
                  <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden="true" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
