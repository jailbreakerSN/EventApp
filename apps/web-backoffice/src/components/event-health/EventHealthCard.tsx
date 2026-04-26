"use client";

/**
 * Organizer overhaul — Phase O3.
 *
 * Composite event-health card for the event-detail page. Bundles:
 *   - <HealthGauge />        : circular score gauge.
 *   - Component breakdown    : list of the 7 weighted criteria.
 *   - <PacingChart />        : registration trajectory vs expected.
 *
 * Loading + error states handled inline — falls back to a skeleton
 * card so the page layout doesn't shift while the score loads.
 */

import { Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEventHealth } from "@/hooks/use-event-health";
import { HealthGauge } from "./HealthGauge";
import { PacingChart } from "./PacingChart";

export interface EventHealthCardProps {
  eventId: string;
  className?: string;
}

export function EventHealthCard({ eventId, className }: EventHealthCardProps) {
  const { data, isLoading, error } = useEventHealth(eventId);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-6 grid gap-6 md:grid-cols-[180px_1fr]">
          <div className="flex flex-col items-center gap-2">
            <Skeleton variant="circle" className="h-36 w-36" />
            <Skeleton variant="text" className="h-3 w-20" />
          </div>
          <div className="space-y-3">
            <Skeleton variant="text" className="h-4 w-24" />
            <Skeleton variant="text" className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("border-amber-200", className)}>
        <CardContent className="flex items-start gap-3 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-foreground">Score de santé indisponible</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Le calcul du score a échoué. Réessayez dans quelques secondes.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const snapshot = data;
  if (!snapshot) return null;

  return (
    <Card className={className}>
      <CardContent className="p-6 grid gap-6 md:grid-cols-[180px_1fr]">
        {/* Left — gauge */}
        <div className="flex flex-col items-center gap-2">
          <HealthGauge score={snapshot.score} tier={snapshot.tier} />
          {snapshot.pacingPercent !== null && (
            <p className="mt-1 text-[11px] text-muted-foreground text-center">
              Rythme : <strong>{snapshot.pacingPercent}%</strong> du prévu
            </p>
          )}
        </div>

        {/* Right — breakdown + pacing */}
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Composantes du score
            </h3>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {snapshot.components.map((c) => {
                const fullyEarned = c.earned >= c.max;
                const partiallyEarned = c.earned > 0 && c.earned < c.max;
                return (
                  <li key={c.key} className="flex items-start gap-2 text-xs" title={c.detail}>
                    {fullyEarned ? (
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
                        aria-hidden="true"
                      />
                    ) : partiallyEarned ? (
                      <Circle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground truncate">{c.label}</span>
                        <span className="text-muted-foreground tabular-nums shrink-0">
                          {c.earned}/{c.max}
                        </span>
                      </div>
                      <p className="text-muted-foreground/80 truncate">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rythme d&apos;inscription
            </h3>
            <PacingChart pacing={snapshot.pacing} width={520} height={180} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
