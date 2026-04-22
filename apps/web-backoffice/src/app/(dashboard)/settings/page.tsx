"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { User, Shield, Bell, Save, Loader2, Check, Eye, EyeOff, Phone, Globe } from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Input,
  InlineErrorBanner,
  Select,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";

// ─── Password strength helper ────────────────────────────────────────────────

interface PasswordStrength {
  score: number; // 0-4
  label: string;
  color: string;
}

function evaluatePassword(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;

  const levels: PasswordStrength[] = [
    { score: 0, label: "Trop faible", color: "bg-red-500" },
    { score: 1, label: "Faible", color: "bg-orange-500" },
    { score: 2, label: "Moyen", color: "bg-yellow-500" },
    { score: 3, label: "Bon", color: "bg-green-400" },
    { score: 4, label: "Excellent", color: "bg-green-600" },
  ];

  return levels[score];
}

// ─── Notification preferences (localStorage) ────────────────────────────────

interface NotificationPrefs {
  newRegistrations: boolean;
  paymentsReceived: boolean;
  messagesReceived: boolean;
  eventReminders: boolean;
  preferEmail: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  newRegistrations: true,
  paymentsReceived: true,
  messagesReceived: true,
  eventReminders: true,
  preferEmail: true,
};

const PREFS_KEY = "teranga_notification_prefs";

function loadPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return DEFAULT_PREFS;
}

function savePrefs(prefs: NotificationPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ─── Toggle component ────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  const t = useTranslations("nav");
  const { user } = useAuth();
  const firebaseUser = firebaseAuth.currentUser;
  const isGoogleAuth = firebaseUser?.providerData.some((p) => p.providerId === "google.com");

  // Profile form
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [language, setLanguage] = useState("fr");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Notification prefs
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  // Separate banners for profile vs password — the two panels live in
  // different cards and a failure in one shouldn't blank out the other's
  // form error. Firebase auth errors (auth/wrong-password etc.) keep
  // their page-specific French copy since it's more actionable than the
  // generic errors.* catalog fallback; useErrorHandler still reports to
  // observability so the failure doesn't go untraced.
  const [profileError, setProfileError] = useState<ResolvedError | null>(null);
  const [passwordError, setPasswordError] = useState<ResolvedError | null>(null);
  const { resolve: resolveError } = useErrorHandler();
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");
  const tErrorValidation = useTranslations("errors.validation");

  // Load data
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? "");
    }
    // Load phone/language from localStorage (no API endpoint yet)
    if (typeof window !== "undefined") {
      setPhoneNumber(localStorage.getItem("teranga_phone") ?? "");
      setLanguage(localStorage.getItem("teranga_language") ?? "fr");
    }
    setPrefs(loadPrefs());
  }, [user]);

  // ─── Profile save ──────────────────────────────────────────────────────────

  const handleSaveProfile = async () => {
    if (!firebaseUser) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      await updateProfile(firebaseUser, { displayName: displayName.trim() });
      // Save phone and language locally until API supports it
      localStorage.setItem("teranga_phone", phoneNumber);
      localStorage.setItem("teranga_language", language);
      toast.success("Profil mis à jour");
    } catch (err) {
      setProfileError(resolveError(err));
    } finally {
      setSavingProfile(false);
    }
  };

  // ─── Password save ─────────────────────────────────────────────────────────

  const handleChangePassword = async () => {
    if (!firebaseUser || !firebaseUser.email) return;
    setPasswordError(null);

    // Client-side validation errors are surfaced via the banner as
    // VALIDATION_ERROR so they share the same channel as the submit
    // failure below — no "toast now, banner later" split.
    if (newPassword !== confirmPassword) {
      setPasswordError(
        resolveError({
          code: "VALIDATION_ERROR",
          message: tErrorValidation("passwordMismatch"),
        }),
      );
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(
        resolveError({
          code: "VALIDATION_ERROR",
          message: tErrorValidation("passwordTooShort"),
        }),
      );
      return;
    }

    setSavingPassword(true);
    try {
      // Re-authenticate first
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Mot de passe mis à jour");
    } catch (err: unknown) {
      const errorCode =
        err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
      // Firebase auth codes stay with their specific French copy (more
      // actionable than the generic errors.* catalog fallback), but we
      // still resolve through useErrorHandler so observability gets
      // notified with the firebase code as a tag.
      const resolved = resolveError(err);
      if (errorCode === "auth/wrong-password") {
        setPasswordError({
          ...resolved,
          title: "Mot de passe actuel incorrect",
          description: "Vérifiez votre mot de passe actuel et réessayez.",
        });
      } else if (errorCode === "auth/weak-password") {
        setPasswordError({
          ...resolved,
          title: "Mot de passe trop faible",
          description: "Utilisez au moins 8 caractères avec un mélange de lettres et de chiffres.",
        });
      } else {
        setPasswordError(resolved);
      }
    } finally {
      setSavingPassword(false);
    }
  };

  // ─── Notification prefs save ───────────────────────────────────────────────

  const handleSavePrefs = () => {
    savePrefs(prefs);
    toast.success("Préférences de notifications enregistrées");
  };

  const updatePref = (key: keyof NotificationPrefs, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const passwordStrength = evaluatePassword(newPassword);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb className="mb-2">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Parametres</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("settings")}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerez votre profil, la securite de votre compte et vos preferences de notifications.
        </p>
      </div>

      {/* ─── Section 1: Profil ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="h-4 w-4" /> Profil
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Nom complet
              </label>
              <Input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Votre nom"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
              <Input
                type="email"
                value={user?.email ?? ""}
                readOnly
                className="bg-muted cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                <Phone className="h-3 w-3 inline mr-1" />
                Telephone
              </label>
              <Input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+221 7X XXX XX XX"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                <Globe className="h-3 w-3 inline mr-1" />
                Langue
              </label>
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="fr">Francais</option>
                <option value="en">English</option>
                <option value="wo">Wolof</option>
              </Select>
            </div>
          </div>

          {profileError && (
            <div className="mt-5">
              <InlineErrorBanner
                severity={profileError.severity}
                kicker={tErrors("kicker")}
                title={profileError.title}
                description={profileError.description}
                onDismiss={() => setProfileError(null)}
                dismissLabel={tErrorActions("dismiss")}
              />
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <Button onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Section 2: Securite ────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4" /> Securite
          </h2>

          {isGoogleAuth ? (
            <div className="flex items-center gap-3 rounded-lg bg-muted p-4">
              <div className="rounded-full bg-blue-100 p-2">
                <Check className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Connecte via Google</p>
                <p className="text-xs text-muted-foreground">
                  La gestion du mot de passe se fait via votre compte Google.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Changer le mot de passe</h3>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Mot de passe actuel
                </label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Entrez votre mot de passe actuel"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showCurrentPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"
                    }
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Au moins 8 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showNewPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"
                    }
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Password strength indicator */}
                {newPassword.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${
                            i < passwordStrength.score ? passwordStrength.color : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{passwordStrength.label}</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Confirmer le nouveau mot de passe
                </label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmez votre nouveau mot de passe"
                />
                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                  <p className="text-xs text-red-500 mt-1">
                    {tErrorValidation("passwordMismatch")}
                  </p>
                )}
              </div>

              {passwordError && (
                <InlineErrorBanner
                  severity={passwordError.severity}
                  kicker={tErrors("kicker")}
                  title={passwordError.title}
                  description={passwordError.description}
                  onDismiss={() => setPasswordError(null)}
                  dismissLabel={tErrorActions("dismiss")}
                />
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleChangePassword}
                  disabled={
                    savingPassword ||
                    !currentPassword ||
                    !newPassword ||
                    newPassword !== confirmPassword
                  }
                >
                  {savingPassword ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Mettre a jour
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Section 3: Notifications ───────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <Bell className="h-4 w-4" /> Notifications
          </h2>

          <div className="divide-y divide-border">
            <Toggle
              checked={prefs.newRegistrations}
              onChange={(v) => updatePref("newRegistrations", v)}
              label="Nouvelles inscriptions"
              description="Recevez une notification pour chaque nouvelle inscription"
            />
            <Toggle
              checked={prefs.paymentsReceived}
              onChange={(v) => updatePref("paymentsReceived", v)}
              label="Paiements recus"
              description="Soyez informe des paiements recus"
            />
            <Toggle
              checked={prefs.messagesReceived}
              onChange={(v) => updatePref("messagesReceived", v)}
              label="Messages recus"
              description="Notification pour les nouveaux messages"
            />
            <Toggle
              checked={prefs.eventReminders}
              onChange={(v) => updatePref("eventReminders", v)}
              label="Rappels d'evenements"
              description="Rappels avant le debut de vos evenements"
            />
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Canal de notification prefere
            </p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="notifChannel"
                  checked={prefs.preferEmail}
                  onChange={() => updatePref("preferEmail", true)}
                  className="accent-primary"
                />
                Email
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="notifChannel"
                  checked={!prefs.preferEmail}
                  onChange={() => updatePref("preferEmail", false)}
                  className="accent-primary"
                />
                Push
              </label>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={handleSavePrefs}>
              <Save className="h-4 w-4 mr-2" />
              Enregistrer les preferences
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
