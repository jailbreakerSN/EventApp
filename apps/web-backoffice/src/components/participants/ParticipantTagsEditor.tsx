"use client";

/**
 * Organizer overhaul — Phase O7.
 *
 * Inline tag-editor + organizer-notes panel for one (org, participant)
 * profile. Renders a chip group with an `+` action that prompts for a
 * new tag name, and a textarea for notes.
 *
 * Controlled by the parent — the parent owns the persisted profile
 * value + the mutation hook. This component is a pure form view.
 */

import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Card, CardContent, Textarea, Button } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";

export interface ParticipantTagsEditorProps {
  tags: readonly string[];
  notes: string;
  busy?: boolean;
  onChange: (next: { tags: string[]; notes: string }) => void;
  onSave: () => void;
  className?: string;
}

export function ParticipantTagsEditor({
  tags,
  notes,
  busy = false,
  onChange,
  onSave,
  className,
}: ParticipantTagsEditorProps) {
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) return;
    onChange({ tags: [...tags, trimmed], notes });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    onChange({ tags: tags.filter((t) => t !== tag), notes });
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <Card className={className}>
      <CardContent className="space-y-4 py-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tags
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-teranga-gold/10 px-2.5 py-0.5 text-xs font-medium text-teranga-gold"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Retirer le tag ${tag}`}
                  className="text-teranga-gold/70 hover:text-teranga-gold"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-1 py-0.5">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKey}
                placeholder="Ajouter un tag…"
                aria-label="Nouveau tag"
                maxLength={40}
                className={cn(
                  "border-0 bg-transparent text-xs px-1.5 py-0.5 w-32 placeholder:text-muted-foreground/70 focus:outline-none",
                )}
              />
              <button
                type="button"
                onClick={addTag}
                disabled={tagInput.trim().length === 0}
                aria-label="Confirmer l'ajout"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        <div>
          <label
            htmlFor="participant-notes"
            className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Note organisateur
          </label>
          <Textarea
            id="participant-notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => onChange({ tags: [...tags], notes: e.target.value })}
            placeholder="Cette note n'est jamais visible par le participant…"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Les notes sont privées : seuls les membres de votre organisation peuvent les lire.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={onSave}
            disabled={busy}
            className="bg-teranga-gold hover:bg-teranga-gold/90"
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
