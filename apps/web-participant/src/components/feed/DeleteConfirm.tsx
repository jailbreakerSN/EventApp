"use client";

interface DeleteConfirmProps {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirm({ label, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
      <p className="text-sm text-foreground">{label}</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
        >
          Confirmer
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
