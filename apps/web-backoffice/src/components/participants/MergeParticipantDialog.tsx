"use client";

/**
 * Organizer overhaul — Phase O7.
 *
 * Confirmation dialog for merging two participants. Shows:
 *   - the match kind (email / phone) + the value that triggered detection,
 *   - the two user ids in primary / secondary slots,
 *   - the irreversible nature of the merge,
 *   - a confirm button that fires the mutation.
 *
 * The parent owns the mutation state — this dialog is a pure render +
 * confirm callback wrapper around `<ConfirmDialog>` from shared-ui.
 */

import { ConfirmDialog } from "@teranga/shared-ui";
import type { DuplicateCandidate } from "@teranga/shared-types";

export interface MergeParticipantDialogProps {
  candidate: DuplicateCandidate | null;
  /** True while the merge mutation is in-flight. */
  busy?: boolean;
  /** Called when the user confirms — primary keeps, secondary folds in. */
  onConfirm: (candidate: DuplicateCandidate) => Promise<void> | void;
  onClose: () => void;
}

export function MergeParticipantDialog({
  candidate,
  busy = false,
  onConfirm,
  onClose,
}: MergeParticipantDialogProps) {
  if (!candidate) return null;

  const handleConfirm = async () => {
    await onConfirm(candidate);
  };

  const matchLabel = candidate.matchKind === "email" ? "Email partagé" : "Téléphone partagé";

  return (
    <ConfirmDialog
      open={candidate !== null}
      onCancel={onClose}
      onConfirm={handleConfirm}
      title="Fusionner les participants ?"
      description={
        `${matchLabel} : ${candidate.matchValue}. ` +
        `Le profil principal (${candidate.primaryUserId}) conservera toutes les inscriptions ; ` +
        `le profil secondaire (${candidate.secondaryUserId}) sera archivé. ` +
        `Cette opération est irréversible.`
      }
      confirmLabel={busy ? "Fusion en cours…" : "Confirmer la fusion"}
      cancelLabel="Annuler"
      variant="danger"
    />
  );
}
