"use client";

/**
 * Organizer overhaul — Phase O5.
 *
 * Browser for the seeded comms-template library. Renders a tabbed
 * category strip + a card grid with one card per template, each
 * card showing title preview, body preview, suggested channels,
 * and a "Utiliser ce modèle" CTA that fires the `onPick` callback.
 *
 * The composer uses this picker through a callback rather than a
 * shared store — keeps the library component reusable in other
 * contexts (e.g. a future template-management admin page).
 */

import { useMemo, useState } from "react";
import { Mail, Smartphone, Bell, Sparkles, Clock, MessageCircle } from "lucide-react";
import { Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";
import { useCommsTemplates } from "@/hooks/use-comms-templates";
import type {
  CommsTemplate,
  CommsTemplateCategory,
  CommunicationChannel,
} from "@teranga/shared-types";

const CATEGORY_TABS: ReadonlyArray<{ id: "all" | CommsTemplateCategory; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "reminder", label: "Rappels" },
  { id: "confirmation", label: "Confirmations" },
  { id: "lifecycle", label: "Cycle de vie" },
  { id: "reengagement", label: "Réengagement" },
];

const CHANNEL_ICON: Record<CommunicationChannel, typeof Mail> = {
  email: Mail,
  sms: Smartphone,
  push: Bell,
  whatsapp: MessageCircle,
  in_app: Bell,
};

export interface CommsTemplateLibraryProps {
  onPick?: (template: CommsTemplate) => void;
  className?: string;
}

export function CommsTemplateLibrary({ onPick, className }: CommsTemplateLibraryProps) {
  const [activeTab, setActiveTab] = useState<"all" | CommsTemplateCategory>("all");
  const queryCategory = activeTab === "all" ? undefined : activeTab;
  const { data: templates, isLoading } = useCommsTemplates(queryCategory);

  const visible = useMemo(() => templates ?? [], [templates]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Catégories de templates">
        {CATEGORY_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border motion-safe:transition-colors",
                active
                  ? "border-teranga-gold bg-teranga-gold/10 text-teranga-gold"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton variant="text" className="h-3 w-1/3" />
                <Skeleton variant="text" className="h-5 w-3/4" />
                <Skeleton variant="text" className="h-3 w-full" />
                <Skeleton variant="text" className="h-3 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && visible.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Aucun template dans cette catégorie pour le moment.
          </CardContent>
        </Card>
      )}

      {!isLoading && visible.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((template) => (
            <TemplateCard key={template.id} template={template} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onPick,
}: {
  template: CommsTemplate;
  onPick?: (template: CommsTemplate) => void;
}) {
  return (
    <Card className="hover:border-teranga-gold/40 motion-safe:transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {template.category}
          </span>
          {template.timing && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {template.timing}
            </span>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{template.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-foreground line-clamp-2">{template.title}</p>
          <p className="text-[11px] text-muted-foreground line-clamp-3">{template.body}</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            {template.defaultChannels.map((ch) => {
              const Icon = CHANNEL_ICON[ch];
              return (
                <span
                  key={ch}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  title={ch}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                </span>
              );
            })}
          </div>
          {onPick && (
            <button
              type="button"
              onClick={() => onPick(template)}
              className="inline-flex items-center gap-1 text-xs font-medium text-teranga-gold hover:underline"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Utiliser ce modèle
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
