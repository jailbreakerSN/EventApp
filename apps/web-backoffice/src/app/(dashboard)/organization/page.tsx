"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  useOrganization,
  useUpdateOrganization,
  useOrgInvites,
  useCreateInvite,
  useRevokeInvite,
  useRemoveMember,
  useUpdateMemberRole,
} from "@/hooks/use-organization";
import {
  Building2,
  Users,
  Mail,
  Globe,
  Phone,
  Save,
  Loader2,
  Send,
  X,
  UserPlus,
  Crown,
  Shield,
  User,
  Eye,
  Trash2,
} from "lucide-react";
import { Badge, getStatusVariant, InlineErrorBanner } from "@teranga/shared-ui";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import type { OrgMemberRole } from "@teranga/shared-types";
import { usePlansCatalogMap, getPlanDisplay } from "@/hooks/use-plans-catalog";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { UsageMeter } from "@/components/plan/UsageMeter";
import { ArrowUpRight, CreditCard } from "lucide-react";
import Link from "next/link";

const ROLE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  owner: {
    label: "Propriétaire",
    icon: <Crown className="h-3.5 w-3.5" />,
    color: "text-amber-600 bg-amber-50",
  },
  admin: {
    label: "Admin",
    icon: <Shield className="h-3.5 w-3.5" />,
    color: "text-blue-600 bg-blue-50",
  },
  member: {
    label: "Membre",
    icon: <User className="h-3.5 w-3.5" />,
    color: "text-muted-foreground bg-accent",
  },
  viewer: {
    label: "Lecteur",
    icon: <Eye className="h-3.5 w-3.5" />,
    color: "text-muted-foreground bg-muted",
  },
};

const INVITE_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  accepted: "Acceptée",
  declined: "Refusée",
  expired: "Expirée",
};

export default function OrganizationPage() {
  const t = useTranslations("nav");
  const { data: orgData, isLoading } = useOrganization();
  const { data: invitesData } = useOrgInvites();
  const updateOrg = useUpdateOrganization();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const removeMember = useRemoveMember();
  const updateMemberRole = useUpdateMemberRole();

  const org = orgData?.data;
  const invites = invitesData?.data ?? [];

  // Persistent banner for blocking mutation failures (org update, invite,
  // remove member, change role). One banner for the whole page — a failed
  // action from any of the four mutations lands here with targeted copy.
  const [mutationError, setMutationError] = useState<ResolvedError | null>(null);
  const { resolve: resolveError } = useErrorHandler();
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgMemberRole>("member");
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<string | null>(null);

  // Settings form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [city, setCity] = useState("");

  // Initialize form when org data loads
  useEffect(() => {
    if (org) {
      setName(org.name ?? "");
      setDescription(org.description ?? "");
      setEmail(org.email ?? "");
      setPhone(org.phone ?? "");
      setWebsite(org.website ?? "");
      setCity(org.city ?? "");
    }
  }, [org]);

  const handleSaveSettings = async () => {
    if (!org) return;
    setMutationError(null);
    try {
      await updateOrg.mutateAsync({
        name: name || undefined,
        description: description || undefined,
        email: email || undefined,
        phone: phone || undefined,
        website: website || undefined,
        city: city || undefined,
      });
      toast.success("Organisation mise à jour");
    } catch (err) {
      setMutationError(resolveError(err));
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setMutationError(null);
    try {
      await createInvite.mutateAsync({
        email: inviteEmail.trim(),
        role: inviteRole as "admin" | "member" | "viewer",
      });
      setInviteEmail("");
      setShowInviteForm(false);
      toast.success("Invitation envoyée");
    } catch (err) {
      setMutationError(resolveError(err));
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setMutationError(null);
    try {
      await removeMember.mutateAsync(userId);
      toast.success("Membre retiré");
      setConfirmRemoveMemberId(null);
    } catch (err) {
      setMutationError(resolveError(err));
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setMutationError(null);
    try {
      await updateMemberRole.mutateAsync({ userId, role: newRole });
      toast.success("Rôle mis à jour");
    } catch (err) {
      setMutationError(resolveError(err));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Building2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
        <p>Aucune organisation trouvée.</p>
        <p className="text-sm mt-1">Contactez un administrateur pour configurer votre compte.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-foreground mb-6">{t("organization")}</h1>

      {mutationError && (
        <InlineErrorBanner
          className="mb-6"
          severity={mutationError.severity}
          kicker={tErrors("kicker")}
          title={mutationError.title}
          description={mutationError.description}
          onDismiss={() => setMutationError(null)}
          dismissLabel={tErrorActions("dismiss")}
        />
      )}

      {/* Plan card */}
      <PlanCard plan={org.plan} memberCount={org.memberIds?.length ?? 0} />

      {/* Settings */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Paramètres
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Nom</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Ville</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="Dakar"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              <Mail className="h-3 w-3 inline mr-1" />
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              <Phone className="h-3 w-3 inline mr-1" />
              Téléphone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              <Globe className="h-3 w-3 inline mr-1" />
              Site web
            </label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="https://"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={updateOrg.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            {updateOrg.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Enregistrer
          </button>
        </div>

        {updateOrg.isSuccess && (
          <p className="mt-2 text-sm text-green-600 text-right">Modifications enregistrées.</p>
        )}
      </div>

      {/* Team Management */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4" /> Équipe
          </h2>
          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/80 transition-colors"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Inviter
          </button>
        </div>

        {/* Invite form */}
        {showInviteForm && (
          <div className="mb-4 p-4 bg-muted rounded-lg border border-border">
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@exemple.com"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgMemberRole)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="member">Membre</option>
                <option value="admin">Admin</option>
                <option value="viewer">Lecteur</option>
              </select>
              <button
                onClick={handleSendInvite}
                disabled={createInvite.isPending || !inviteEmail.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/80 disabled:opacity-50"
              >
                {createInvite.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Envoyer
              </button>
            </div>
            {createInvite.isError && (
              <p className="mt-2 text-sm text-red-600">{(createInvite.error as Error).message}</p>
            )}
          </div>
        )}

        {/* Members list */}
        <div className="text-sm text-muted-foreground mb-3">
          {org.memberIds?.length ?? 0} membre{(org.memberIds?.length ?? 0) > 1 ? "s" : ""}
        </div>

        <div className="divide-y divide-border">
          {org.memberIds?.map((memberId, index) => {
            const isOwner = memberId === org.ownerId;
            const role = isOwner ? ROLE_LABELS.owner : ROLE_LABELS.member;
            return (
              <div key={memberId} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-medium text-muted-foreground">
                    {String(index + 1)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{memberId}</p>
                    {isOwner ? (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${role.color}`}
                      >
                        {role.icon} {role.label}
                      </span>
                    ) : (
                      <select
                        defaultValue="member"
                        onChange={(e) => handleRoleChange(memberId, e.target.value)}
                        disabled={updateMemberRole.isPending}
                        className="mt-0.5 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Membre</option>
                        <option value="viewer">Lecteur</option>
                      </select>
                    )}
                  </div>
                </div>
                {!isOwner && (
                  <div className="flex items-center gap-2">
                    {confirmRemoveMemberId === memberId ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Êtes-vous sûr de vouloir retirer ce membre ?
                        </span>
                        <button
                          onClick={() => handleRemoveMember(memberId)}
                          disabled={removeMember.isPending}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {removeMember.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Confirmer"
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveMemberId(null)}
                          className="px-2 py-1 text-xs bg-accent text-muted-foreground rounded-md hover:bg-accent/80 transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveMemberId(memberId)}
                        className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                        title="Retirer le membre"
                        aria-label="Retirer le membre"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Invitations */}
      {invites.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Mail className="h-4 w-4" /> Invitations
          </h2>

          <div className="divide-y divide-border">
            {invites.map((invite) => {
              return (
                <div key={invite.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{invite.email}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant={getStatusVariant(invite.status)}>
                        {INVITE_STATUS_LABELS[invite.status] ?? invite.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {ROLE_LABELS[invite.role]?.label ?? invite.role}
                      </span>
                    </div>
                  </div>
                  {invite.status === "pending" && (
                    <button
                      onClick={() => revokeInvite.mutate(invite.id)}
                      className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Révoquer"
                      aria-label="Révoquer l'invitation"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, memberCount }: { plan: string; memberCount: number }) {
  const { checkLimit } = usePlanGating();
  const { map: catalog } = usePlansCatalogMap();
  const display = getPlanDisplay(plan, catalog);
  const events = checkLimit("events");
  const members = checkLimit("members");

  const planColors: Record<string, string> = {
    free: "bg-muted text-muted-foreground",
    starter: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    pro: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    enterprise: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Plan actuel</p>
            <p className="text-lg font-bold text-primary">{display?.name.fr ?? plan}</p>
          </div>
          <span
            className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${planColors[plan] ?? planColors.free}`}
          >
            {display?.name.fr ?? plan}
          </span>
        </div>
        <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-full">
          {memberCount} membre{memberCount > 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <UsageMeter label="Événements actifs" current={events.current} limit={events.limit} />
        <UsageMeter label="Membres" current={members.current} limit={members.limit} />
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/organization/billing"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
        >
          <CreditCard className="h-4 w-4" />
          Gérer mon plan
        </Link>
        {plan !== "enterprise" && (
          <Link
            href="/organization/billing"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Passer au plan supérieur
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
