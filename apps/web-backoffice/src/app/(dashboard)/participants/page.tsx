"use client";

/**
 * Organizer overhaul — Phase O7.
 *
 * Cross-event participants directory + duplicate-detection surface.
 * Replaces the previous stub. Two tabs:
 *
 *   - **Annuaire** : reusable bulk + saved-views chrome ready for the
 *     Wave-4 cross-event participant list. The MVP renders a CTA
 *     pointing to per-event /audience/registrations where bulk lives.
 *   - **Doublons** : detected duplicate pairs ready for merge.
 *
 * Most of the heavy lifting lives in `<BulkActionToolbar>`,
 * `<SavedViewsMenu>`, `<MergeParticipantDialog>` and the
 * participant-ops hooks. The page is the wiring layer.
 */

import { useMemo, useState } from "react";
import { Users, AlertCircle, Mail, Phone, Tag, Trash2, CheckCircle2, Sparkles } from "lucide-react";
import { Card, CardContent, Spinner, Button } from "@teranga/shared-ui";
import { toast } from "sonner";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { useDuplicateCandidates, useMergeParticipants } from "@/hooks/use-participant-ops";
import { SavedViewsMenu } from "@/components/data-ops/SavedViewsMenu";
import { BulkActionToolbar, type BulkAction } from "@/components/data-ops/BulkActionToolbar";
import { MergeParticipantDialog } from "@/components/participants/MergeParticipantDialog";
import type { DuplicateCandidate } from "@teranga/shared-types";
import { cn } from "@/lib/utils";

type Tab = "directory" | "duplicates";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "directory", label: "Annuaire", icon: Users },
  { id: "duplicates", label: "Doublons", icon: AlertCircle },
];

export default function ParticipantsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [activeTab, setActiveTab] = useState<Tab>("directory");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Participants</h1>
          <p className="text-sm text-muted-foreground">
            Annuaire transversal de vos inscrits, gestion des tags et détection des doublons.
          </p>
        </div>
        {activeTab === "directory" && <SavedViewsMenu surfaceKey="participants:directory" />}
      </div>

      {/* Tab strip */}
      <nav
        className="flex gap-1 border-b border-border overflow-x-auto scrollbar-none"
        aria-label="Sections Participants"
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 motion-safe:transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === "directory" && <DirectoryTab orgId={orgId} />}
      {activeTab === "duplicates" && <DuplicatesTab orgId={orgId} />}
    </div>
  );
}

function DirectoryTab({ orgId }: { orgId: string | null }) {
  const allIds = useMemo<string[]>(() => [], []);
  const bulk = useBulkSelection<string>(allIds);

  const bulkActions: BulkAction[] = [
    {
      id: "tag",
      label: "Ajouter un tag",
      icon: Tag,
      onClick: () => toast.info("Bulk-tag dispo dans la table inscriptions de chaque événement."),
    },
    {
      id: "cancel",
      label: "Annuler les inscriptions",
      icon: Trash2,
      variant: "destructive",
      onClick: () =>
        toast.info("Bulk-cancel dispo dans la table inscriptions de chaque événement."),
    },
  ];

  if (!orgId) {
    return (
      <Card>
        <CardContent className="p-12 flex flex-col items-center justify-center text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">Annuaire indisponible</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Votre compte n&apos;est rattaché à aucune organisation.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-12 flex flex-col items-center justify-center text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">Annuaire transversal</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            Pour la première itération O7, les actions groupées (tag, annulation, export, envoi de
            message) vivent dans la table « Inscriptions » de chaque événement. L&apos;annuaire
            cross-événements arrive en O10.
          </p>
          <Link
            href="/events"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            Voir mes événements
          </Link>
        </CardContent>
      </Card>

      {/* Render the toolbar even though selection is empty so the
          chrome wiring is reviewable; the toolbar self-hides when
          selectedCount === 0. */}
      <BulkActionToolbar
        selectedCount={bulk.size}
        actions={bulkActions}
        onClearSelection={bulk.clear}
      />
    </div>
  );
}

function DuplicatesTab({ orgId }: { orgId: string | null }) {
  const { data: candidates, isLoading, error } = useDuplicateCandidates(orgId);
  const merge = useMergeParticipants(orgId ?? "");
  const [activeCandidate, setActiveCandidate] = useState<DuplicateCandidate | null>(null);

  if (!orgId) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Sélectionnez une organisation pour détecter les doublons.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="p-4 text-sm text-red-700">
          Erreur lors de la détection. Réessayez.
        </CardContent>
      </Card>
    );
  }

  const list = candidates ?? [];

  if (list.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="flex items-center gap-3 p-6">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">Aucun doublon détecté</p>
            <p className="text-xs text-muted-foreground">
              Les emails et téléphones de votre organisation sont uniques.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleConfirmMerge = async (candidate: DuplicateCandidate) => {
    try {
      const result = await merge.mutateAsync({
        primaryUserId: candidate.primaryUserId,
        secondaryUserId: candidate.secondaryUserId,
      });
      toast.success(`Fusion terminée — ${result.registrationsMoved} inscription(s) re-pointée(s).`);
      setActiveCandidate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la fusion.");
    }
  };

  return (
    <>
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.pairId}>
            <Card>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  {c.matchKind === "email" ? (
                    <Mail className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                  ) : (
                    <Phone className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.matchValue}</p>
                    <p className="text-xs text-muted-foreground">
                      Principal : {c.primaryUserId} · Secondaire : {c.secondaryUserId}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveCandidate(c)}
                  className="shrink-0"
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Fusionner
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <MergeParticipantDialog
        candidate={activeCandidate}
        busy={merge.isPending}
        onConfirm={handleConfirmMerge}
        onClose={() => setActiveCandidate(null)}
      />
    </>
  );
}
