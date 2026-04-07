"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { speakersApi } from "@/lib/api-client";
import { Calendar, Clock, MapPin, FileText, Edit3, Save, Loader2, ExternalLink } from "lucide-react";
import type { SpeakerProfile, Session } from "@teranga/shared-types";

export default function SpeakerPortalPage() {
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
    } catch (err) {
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
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
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
      // Error handled silently
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Chargement...
      </div>
    );
  }

  if (error || !speaker) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-destructive">{error ?? "Profil introuvable."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground">Espace Intervenant</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Gérez votre profil et consultez votre programme.
      </p>

      {/* Profile Section */}
      <section className="mt-8 rounded-lg border bg-card p-6 shadow-sm">
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
              alt={speaker.fullName}
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teranga-navy text-2xl font-bold text-teranga-gold">
              {speaker.fullName.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-xl font-semibold">{speaker.fullName}</h3>
            {speaker.title && <p className="text-sm text-muted-foreground">{speaker.title}</p>}
            {speaker.company && <p className="text-sm text-muted-foreground">{speaker.company}</p>}
          </div>
        </div>

        {editing ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Bio</label>
              <textarea
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Présentez-vous en quelques lignes..."
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Sujets d&apos;expertise (séparés par des virgules)</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="IA, Cloud, DevOps..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Twitter</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="@handle"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">LinkedIn</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={linkedin}
                  onChange={(e) => setLinkedin(e.target.value)}
                  placeholder="URL LinkedIn"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Site web</label>
                <input
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
            {speaker.bio && <p className="text-sm text-muted-foreground whitespace-pre-line">{speaker.bio}</p>}
            {speaker.topics && speaker.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {speaker.topics.map((topic) => (
                  <span key={topic} className="rounded-full border px-2.5 py-0.5 text-xs font-medium">
                    {topic}
                  </span>
                ))}
              </div>
            )}
            {speaker.socialLinks && (
              <div className="mt-3 flex gap-4 text-sm text-muted-foreground">
                {speaker.socialLinks.twitter && (
                  <a href={`https://twitter.com/${speaker.socialLinks.twitter}`} target="_blank" rel="noreferrer" className="hover:text-teranga-gold">
                    Twitter
                  </a>
                )}
                {speaker.socialLinks.linkedin && (
                  <a href={speaker.socialLinks.linkedin} target="_blank" rel="noreferrer" className="hover:text-teranga-gold">
                    LinkedIn
                  </a>
                )}
                {speaker.socialLinks.website && (
                  <a href={speaker.socialLinks.website} target="_blank" rel="noreferrer" className="hover:text-teranga-gold">
                    Site web <ExternalLink className="inline h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Sessions Section */}
      <section className="mt-6 rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">
          <Calendar className="inline h-5 w-5 mr-1.5 text-teranga-gold" />
          Mon programme ({sessions.length})
        </h2>

        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Aucune session assignée pour le moment.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-md border p-4">
                <h3 className="font-medium">{session.title}</h3>
                {session.description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{session.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(session.startTime).toLocaleString("fr-FR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {" — "}
                    {new Date(session.endTime).toLocaleString("fr-FR", { timeStyle: "short" })}
                  </span>
                  {session.room && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {session.room}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Slides Upload Section */}
      <section className="mt-6 rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">
          <FileText className="inline h-5 w-5 mr-1.5 text-teranga-gold" />
          Mes présentations
        </h2>
        <p className="text-sm text-muted-foreground">
          Vous pouvez téléverser vos supports de présentation (PDF) ici.
          Ils seront disponibles pour les participants après votre session.
        </p>
        <div className="mt-4 rounded-md border-2 border-dashed border-gray-200 p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-2 text-sm text-muted-foreground">
            Glissez-déposez vos fichiers PDF ici ou cliquez pour sélectionner
          </p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, max 20 Mo</p>
        </div>
      </section>
    </div>
  );
}
