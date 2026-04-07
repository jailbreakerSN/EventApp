"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";
import { Button, Input, Card, CardHeader, CardTitle, CardContent, Spinner, getErrorMessage } from "@teranga/shared-ui";

export default function ProfilePage() {
  const { data: profileData, isLoading } = useProfile();
  const updateMutation = useUpdateProfile();

  const profile = (profileData as { data?: Record<string, string | null> })?.data;

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [language, setLanguage] = useState("fr");

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? "");
      setPhone(profile.phone ?? "");
      setBio(profile.bio ?? "");
      setLanguage(profile.preferredLanguage ?? "fr");
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMutation.mutateAsync({ displayName, phone, bio, preferredLanguage: language });
      toast.success("Profil mis à jour avec succès.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold">Mon profil</h1>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Informations personnelles</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <Input id="email" value={profile?.email ?? ""} disabled className="bg-muted" />
            </div>

            <div className="space-y-2">
              <label htmlFor="displayName" className="text-sm font-medium">Nom complet</label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Prénom Nom"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium">Téléphone</label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+221 77 123 45 67"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="bio" className="text-sm font-medium">Bio</label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Parlez-nous de vous..."
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="language" className="text-sm font-medium">Langue préférée</label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
                <option value="wo">Wolof</option>
              </select>
            </div>

            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
