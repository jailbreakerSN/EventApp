"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { speakersApi, uploadsApi } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  MapPin,
  FileText,
  Edit3,
  Save,
  Loader2,
  ExternalLink,
  Upload,
  Trash2,
  Download,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import type { SpeakerProfile, Session } from "@teranga/shared-types";
import { Skeleton, EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import { useTranslations } from "next-intl";

const ALLOWED_SLIDE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_SLIDE_SIZE = 20 * 1024 * 1024; // 20 Mo

export default function SpeakerPortalPage() {
  const _t = useTranslations("common");
  void _t;
  const { eventId } = useParams<{ eventId: string }>();
  const [speaker, setSpeaker] = useState<SpeakerProfile | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [bio, setBio] = useState("");
  const [topics, setTopics] = useState("");
  const [twitter, setTwitter] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");

  // Slides upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const slidesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, [eventId]);

  async function loadData() {
    try {
      setLoading(true);
      const speakersResult = await speakersApi.list(eventId);
      // Find current user's speaker profile
      const mySpeaker = speakersResult.data?.[0]; // Will be filtered by API for current user
      if (!mySpeaker) {
        setError("Profil d'intervenant introuvable pour cet événement.");
        return;
      }
      setSpeaker(mySpeaker);
      setBio(mySpeaker.bio ?? "");
      setTopics((mySpeaker.topics ?? []).join(", "));
      setTwitter(mySpeaker.socialLinks?.twitter ?? "");
      setLinkedin(mySpeaker.socialLinks?.linkedin ?? "");
      setWebsite(mySpeaker.socialLinks?.website ?? "");

      // Load sessions
      try {
        const sessResult = await speakersApi.getSessions(eventId, mySpeaker.id);
        setSessions(sessResult.data ?? []);
      } catch {
        // Sessions may not be available
      }
    } catch {
      setError("Erreur de chargement. Vérifiez que vous avez accès à cet événement.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!speaker) return;
    setSaving(true);
    try {
      await speakersApi.update(speaker.id, {
        bio,
        topics: topics
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        socialLinks: {
          ...(speaker.socialLinks ?? {}),
          twitter: twitter || undefined,
          linkedin: linkedin || undefined,
          website: website || undefined,
        },
      } as Partial<SpeakerProfile>);
      setEditing(false);
      await loadData();
    } catch {
      toast.error("Erreur lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setSaving(false);
    }
  }

  const handleSlidesSelect = useCallback(
    async (file: File) => {
      if (!speaker) return;

      if (!ALLOWED_SLIDE_TYPES.includes(file.type)) {
        toast.error("Type de fichier non autorisé. Formats acceptés : PDF, JPG, PNG, WebP.");
        return;
      }
      if (file.size > MAX_SLIDE_SIZE) {
        toast.error("Le fichier dépasse la taille maximale de 20 Mo.");
        return;
      }

      setUploading(true);
      setUploadProgress(10);

      try {
        // 1. Get signed URL
        const { data } = await uploadsApi.getSpeakerSignedUrl(speaker.id, {
          fileName: file.name,
          contentType: file.type,
          purpose: "slides",
        });
        setUploadProgress(30);

        if (data.maxBytes && file.size > data.maxBytes) {
          const maxMB = Math.round(data.maxBytes / 1024 / 1024);
          throw new Error(`Fichier trop volumineux (max ${maxMB} Mo)`);
        }
        // 2. Upload file directly to storage. Replay server-signed
        // headers (x-goog-content-length-range) or GCS rejects with
        // 403 SignatureDoesNotMatch. Server enforces size at the edge
        // without relying on the client-side size check above.
        const uploadResponse = await fetch(data.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            ...(data.requiredHeaders ?? {}),
          },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error("Upload échoué");
        }
        setUploadProgress(70);

        // 3. Update speaker profile with slides URL
        await speakersApi.update(speaker.id, {
          slidesUrl: data.publicUrl,
        } as Partial<SpeakerProfile>);
        setUploadProgress(100);

        toast.success("Présentation téléversée avec succès.");
        await loadData();
      } catch {
        toast.error("Erreur lors du téléversement. Veuillez réessayer.");
      } finally {
        setUploading(false);
        setUploadProgress(0);
        if (slidesInputRef.current) {
          slidesInputRef.current.value = "";
        }
      }
    },
    [speaker],
  );

  const handleRemoveSlides = useCallback(async () => {
    if (!speaker) return;
    try {
      await speakersApi.update(speaker.id, {
        slidesUrl: null,
      } as Partial<SpeakerProfile>);
      toast.success("Présentation supprimée.");
      await loadData();
    } catch {
      toast.error("Erreur lors de la suppression.");
    }
  }, [speaker]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleSlidesSelect(file);
    },
    [handleSlidesSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  if (loading) {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-8 space-y-6"
        role="status"
        aria-label="Chargement du portail intervenant"
      >
        <div className="space-y-3">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="bg-card rounded-xl border border-border p-6 space-y-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="bg-card rounded-xl border border-border p-6 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton variant="rectangle" className="h-32" />
        </div>
      </div>
    );
  }

  if (error || !speaker) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— INTROUVABLE"
          title={error ?? "Profil introuvable."}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 space-y-6">
      <Link
        href="/my-events"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mes événements
      </Link>
      <SectionHeader
        kicker="— ESPACE INTERVENANT"
        title="Espace Intervenant"
        subtitle="Gérez votre profil et consultez votre programme."
        size="hero"
        as="h1"
      />

      {/* Profile Section */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Mon profil</h2>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 text-sm text-teranga-gold hover:underline"
            >
              <Edit3 className="h-4 w-4" /> Modifier
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-teranga-gold px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                Annuler
              </button>
            </div>
          )}
        </div>

        <div className="flex items-start gap-4">
          {speaker.photoURL ? (
            <img
              src={speaker.photoURL}
              alt={speaker.name}
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teranga-navy text-2xl font-bold text-teranga-gold">
              {speaker.name.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-xl font-semibold">{speaker.name}</h3>
            {speaker.title && <p className="text-sm text-muted-foreground">{speaker.title}</p>}
            {speaker.company && <p className="text-sm text-muted-foreground">{speaker.company}</p>}
          </div>
        </div>

        {editing ? (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="speaker-bio" className="text-sm font-medium text-muted-foreground">
                Bio
              </label>
              <textarea
                id="speaker-bio"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Présentez-vous en quelques lignes..."
              />
            </div>
            <div>
              <label htmlFor="speaker-topics" className="text-sm font-medium text-muted-foreground">
                Sujets d&apos;expertise (séparés par des virgules)
              </label>
              <input
                id="speaker-topics"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="IA, Cloud, DevOps..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="speaker-twitter"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Twitter
                </label>
                <input
                  id="speaker-twitter"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="@handle"
                />
              </div>
              <div>
                <label
                  htmlFor="speaker-linkedin"
                  className="text-sm font-medium text-muted-foreground"
                >
                  LinkedIn
                </label>
                <input
                  id="speaker-linkedin"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={linkedin}
                  onChange={(e) => setLinkedin(e.target.value)}
                  placeholder="URL LinkedIn"
                />
              </div>
              <div>
                <label
                  htmlFor="speaker-website"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Site web
                </label>
                <input
                  id="speaker-website"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {speaker.bio && (
              <p className="text-sm text-muted-foreground whitespace-pre-line">{speaker.bio}</p>
            )}
            {speaker.topics && speaker.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {speaker.topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}
            {speaker.socialLinks && (
              <div className="mt-3 flex gap-4 text-sm text-muted-foreground">
                {speaker.socialLinks.twitter && (
                  <a
                    href={`https://twitter.com/${speaker.socialLinks.twitter}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-teranga-gold"
                  >
                    Twitter
                  </a>
                )}
                {speaker.socialLinks.linkedin && (
                  <a
                    href={speaker.socialLinks.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-teranga-gold"
                  >
                    LinkedIn
                  </a>
                )}
                {speaker.socialLinks.website && (
                  <a
                    href={speaker.socialLinks.website}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-teranga-gold"
                  >
                    Site web <ExternalLink className="inline h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Sessions Section */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">
          <Calendar className="inline h-5 w-5 mr-1.5 text-teranga-gold" aria-hidden="true" />
          Mon programme ({sessions.length})
        </h2>

        {sessions.length === 0 ? (
          <EmptyStateEditorial
            icon={Calendar}
            kicker="— AUCUNE SESSION"
            title="Aucune session assignée"
            description="Votre programme apparaîtra ici dès que l'organisateur vous attribuera des sessions."
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-md border p-4">
                <h3 className="font-medium">{session.title}</h3>
                {session.description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {session.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {new Date(session.startTime).toLocaleString("fr-FR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {" — "}
                    {new Date(session.endTime).toLocaleString("fr-FR", { timeStyle: "short" })}
                  </span>
                  {session.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {session.location}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Slides Upload Section */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">
          <FileText className="inline h-5 w-5 mr-1.5 text-teranga-gold" aria-hidden="true" />
          Mes présentations
        </h2>
        <p className="text-sm text-muted-foreground">
          Vous pouvez téléverser vos supports de présentation ici. Ils seront disponibles pour les
          participants après votre session.
        </p>

        {/* Uploaded file display */}
        {speaker.slidesUrl && !uploading && (
          <div className="mt-4 flex items-center justify-between rounded-md border bg-muted/50 p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-teranga-gold" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Présentation téléversée</p>
                <a
                  href={speaker.slidesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Download className="h-3 w-3" /> Télécharger
                </a>
              </div>
            </div>
            <button
              onClick={handleRemoveSlides}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-900/50"
              aria-label="Supprimer la présentation"
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer
            </button>
          </div>
        )}

        {/* Upload progress */}
        {uploading && (
          <div className="mt-4 rounded-md border p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-teranga-gold" />
              <div className="flex-1">
                <p className="text-sm font-medium">Téléversement en cours...</p>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-teranga-gold transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Drop zone */}
        {!uploading && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => slidesInputRef.current?.click()}
            className="mt-4 rounded-md border-2 border-dashed border-border p-8 text-center cursor-pointer hover:border-teranga-gold/50 hover:bg-muted/50 transition-colors"
            role="button"
            tabIndex={0}
            aria-label="Téléverser une présentation"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") slidesInputRef.current?.click();
            }}
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {speaker.slidesUrl
                ? "Remplacer la présentation"
                : "Glissez-déposez vos fichiers ici ou cliquez pour sélectionner"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, JPG, PNG, WebP - max 20 Mo</p>
            <input
              ref={slidesInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleSlidesSelect(file);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
