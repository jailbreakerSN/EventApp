"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  Badge,
  Select,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { Calendar, ChevronLeft, ChevronRight, Eye, Users } from "lucide-react";
import { useAdminEvents } from "@/hooks/use-admin";

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "draft", label: "Brouillon" },
  { value: "published", label: "Publié" },
  { value: "cancelled", label: "Annulé" },
  { value: "completed", label: "Terminé" },
  { value: "archived", label: "Archivé" },
] as const;

const STATUS_STYLES: Record<string, { variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline"; label: string }> = {
  draft: { variant: "secondary", label: "Brouillon" },
  published: { variant: "success", label: "Publié" },
  cancelled: { variant: "destructive", label: "Annulé" },
  completed: { variant: "default", label: "Terminé" },
  archived: { variant: "outline", label: "Archivé" },
};

function formatDate(timestamp: string) {
  return new Date(timestamp).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminEventsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const { data, isLoading } = useAdminEvents({
    page,
    limit: 20,
    ...(status ? { status } : {}),
  });

  const events = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Événements</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">Tous les événements</h1>
        <div className="w-full sm:w-56">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrer par statut"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Titre</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Organisation</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Statut</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Date</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden sm:table-cell">Inscrits</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
                      <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-32" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                      <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="px-4 py-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                    </tr>
                  ))
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      <Calendar className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      Aucun événement trouvé
                    </td>
                  </tr>
                ) : (
                  events.map((event: Record<string, unknown>) => {
                    const statusInfo = STATUS_STYLES[(event.status as string) ?? "draft"] ?? STATUS_STYLES.draft;
                    return (
                      <tr key={event.id as string} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {event.title as string}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell font-mono text-xs">
                          {(event.organizationId as string)?.slice(0, 12)}...
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                          {event.startDate ? formatDate(event.startDate as string) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            {(event.registrationCount as number) ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/events/${event.id as string}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            aria-label={`Voir ${event.title as string}`}
                          >
                            <Eye className="h-4 w-4" />
                            <span className="hidden sm:inline">Voir</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} sur {meta.totalPages} ({meta.total} événement{meta.total > 1 ? "s" : ""})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={meta.page >= meta.totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
