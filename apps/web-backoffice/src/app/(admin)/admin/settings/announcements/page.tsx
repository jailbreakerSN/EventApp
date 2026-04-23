"use client";

/**
 * Phase D — Platform announcements CRUD.
 *
 * Super-admins publish short banners (title + body + severity +
 * audience) that the dashboards can surface. The backend
 * /v1/admin/announcements ships POST create + GET list with transactional
 * audit log. This page provides the minimal UI pair: a create form and
 * a list of recent announcements.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SectionHeader,
  Textarea,
} from "@teranga/shared-ui";
import { Megaphone, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  audience: "all" | "organizers" | "participants";
  publishedAt: string;
  expiresAt?: string;
  active: boolean;
  createdBy: string;
}

export default function AdminAnnouncementsPage() {
  const { resolve } = useErrorHandler();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
  const [audience, setAudience] = useState<"all" | "organizers" | "participants">("all");
  const [submitting, setSubmitting] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: Announcement[] }>(
        "/v1/admin/announcements",
      );
      setItems(res.data);
    } catch (err) {
      toast.error(resolve(err).description);
    }
  }, [resolve]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const publish = useCallback(async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Titre et message obligatoires.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/v1/admin/announcements", {
        title: title.trim(),
        body: body.trim(),
        severity,
        audience,
        active: true,
      });
      toast.success("Annonce publiée.");
      setTitle("");
      setBody("");
      setSeverity("info");
      setAudience("all");
      await fetchItems();
    } catch (err) {
      toast.error(resolve(err).description);
    } finally {
      setSubmitting(false);
    }
  }, [title, body, severity, audience, fetchItems, resolve]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/settings/team">Settings</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Annonces</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <SectionHeader
        kicker="— Settings"
        title="Annonces plateforme"
        subtitle="Bannières courtes diffusées aux organisateurs et participants."
      />

      {/* Create form */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Titre</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Maintenance prévue ce soir"
              maxLength={140}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Message</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Corps du message visible dans le banner. Max 1000 caractères."
              maxLength={1000}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Sévérité
              </label>
              <Select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "info" | "warning" | "critical")}
              >
                <option value="info">Info</option>
                <option value="warning">Attention</option>
                <option value="critical">Critique</option>
              </Select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Audience
              </label>
              <Select
                value={audience}
                onChange={(e) =>
                  setAudience(e.target.value as "all" | "organizers" | "participants")
                }
              >
                <option value="all">Tous les utilisateurs</option>
                <option value="organizers">Organisateurs</option>
                <option value="participants">Participants</option>
              </Select>
            </div>
          </div>
          <Button onClick={() => void publish()} disabled={submitting} className="gap-1.5">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {submitting ? "Publication..." : "Publier l'annonce"}
          </Button>
        </CardContent>
      </Card>

      {/* Recent list */}
      {items === null ? (
        <div className="text-sm text-muted-foreground">Chargement…</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm font-semibold text-foreground">Aucune annonce</div>
            <p className="max-w-sm text-xs text-muted-foreground">
              Publiez votre première annonce via le formulaire ci-dessus.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      a.severity === "critical"
                        ? "destructive"
                        : a.severity === "warning"
                          ? "warning"
                          : "info"
                    }
                  >
                    {a.severity}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {a.audience}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(a.publishedAt).toLocaleString("fr-FR")}
                  </span>
                </div>
                <div className="text-sm font-semibold text-foreground">{a.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{a.body}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
