"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";
import { useAuth } from "@/hooks/use-auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import { firebaseAuth, firebaseStorage } from "@/lib/firebase";
import { usersApi } from "@/lib/api-client";
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Spinner,
  getErrorMessage,
} from "@teranga/shared-ui";
import { Camera, Loader2 } from "lucide-react";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 Mo

export default function ProfilePage() {
  const { user } = useAuth();
  const { data: profileData, isLoading } = useProfile();
  const updateMutation = useUpdateProfile();

  const profile = (profileData as { data?: Record<string, string | null> })?.data;

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [language, setLanguage] = useState("fr");

  // Photo upload state
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? "");
      setPhone(profile.phone ?? "");
      setBio(profile.bio ?? "");
      setLanguage(profile.preferredLanguage ?? "fr");
    }
  }, [profile]);

  const currentPhotoURL = photoPreview ?? user?.photoURL ?? profile?.photoURL ?? null;
  const initials = (user?.displayName ?? profile?.displayName ?? "?")
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handlePhotoSelect = useCallback(async (file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Type de fichier non autorisé. Formats acceptés : JPG, PNG, WebP.");
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      toast.error("Le fichier dépasse la taille maximale de 5 Mo.");
      return;
    }

    setUploadingPhoto(true);

    try {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) throw new Error("Non authentifié");

      // Upload to Firebase Storage
      const storagePath = `users/${currentUser.uid}/profile/${Date.now()}-${file.name}`;
      const storageRef = ref(firebaseStorage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const downloadURL = await getDownloadURL(storageRef);

      // Update Firebase Auth profile
      await updateProfile(currentUser, { photoURL: downloadURL });

      // Update backend profile
      await usersApi.updateMe({ photoURL: downloadURL });

      setPhotoPreview(downloadURL);
      toast.success("Photo de profil mise à jour.");
    } catch {
      toast.error("Erreur lors du téléversement de la photo.");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  }, []);

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
          {/* Avatar upload */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="group relative h-24 w-24 rounded-full overflow-hidden border-2 border-border hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                aria-label="Changer la photo de profil"
              >
                {currentPhotoURL ? (
                  <img
                    src={currentPhotoURL}
                    alt="Photo de profil"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary text-2xl font-bold">
                    {initials}
                  </div>
                )}
                {/* Overlay — shows camera icon on hover, spinner when uploading */}
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                    uploadingPhoto
                      ? "bg-black/50 opacity-100"
                      : "bg-black/40 opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {uploadingPhoto ? (
                    <Loader2 className="h-6 w-6 text-white animate-spin" />
                  ) : (
                    <Camera className="h-6 w-6 text-white" />
                  )}
                </div>
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePhotoSelect(file);
                }}
              />
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mb-6">
            Cliquez pour changer la photo (JPG, PNG, WebP - max 5 Mo)
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input id="email" value={profile?.email ?? ""} disabled className="bg-muted" />
            </div>

            <div className="space-y-2">
              <label htmlFor="displayName" className="text-sm font-medium">
                Nom complet
              </label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Prénom Nom"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium">
                Téléphone
              </label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+221 77 123 45 67"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="bio" className="text-sm font-medium">
                Bio
              </label>
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
              <label htmlFor="language" className="text-sm font-medium">
                Langue préférée
              </label>
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
