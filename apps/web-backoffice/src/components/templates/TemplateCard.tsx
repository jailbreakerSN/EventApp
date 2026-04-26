"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * One presentational card per starter template. Renders the icon,
 * label, tagline, and a compact stats row (tickets / sessions /
 * comms blueprints). Click handler is owned by the parent so the
 * card can drive either a wizard or a single-step clone modal.
 */

import {
  GraduationCap,
  Mic,
  PartyPopper,
  Code,
  Building,
  BookOpen,
  HeartHandshake,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";
import type { EventTemplate } from "@teranga/shared-types";

const ICONS: Record<EventTemplate["icon"], LucideIcon> = {
  GraduationCap,
  Mic,
  PartyPopper,
  Code,
  Building,
  BookOpen,
  HeartHandshake,
  Sparkles,
};

export interface TemplateCardProps {
  template: EventTemplate;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function TemplateCard({ template, selected, onSelect, className }: TemplateCardProps) {
  const Icon = ICONS[template.icon];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "text-left w-full group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg",
        className,
      )}
    >
      <Card
        className={cn(
          "h-full motion-safe:transition-all",
          selected
            ? "border-primary ring-2 ring-primary/40 shadow-md"
            : "hover:border-primary/40 hover:shadow-sm",
        )}
      >
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                selected
                  ? "bg-primary text-background"
                  : "bg-teranga-gold/15 text-teranga-gold-dark",
              )}
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{template.label}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                {template.tagline}
              </p>
            </div>
          </div>

          <ul className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <Stat count={template.ticketTypes.length} label="ticket" labelPlural="tickets" />
            <Stat count={template.sessions.length} label="session" labelPlural="sessions" />
            <Stat count={template.commsBlueprint.length} label="rappel" labelPlural="rappels" />
            <li className="px-2 py-0.5 rounded-full bg-muted">{template.defaultDurationHours} h</li>
          </ul>

          {template.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {template.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

function Stat({
  count,
  label,
  labelPlural,
}: {
  count: number;
  label: string;
  labelPlural: string;
}) {
  return (
    <li className="px-2 py-0.5 rounded-full bg-muted">
      {count} {count === 1 ? label : labelPlural}
    </li>
  );
}
