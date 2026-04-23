"use client";

import Link from "next/link";
import { Users, Building2, CalendarDays, Wallet, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAdminStats } from "@/hooks/use-admin";
import {
  Card,
  CardContent,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SectionHeader,
} from "@teranga/shared-ui";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" }).format(value);
}

interface StatCardDef {
  key: string;
  label: string;
  icon: typeof Users;
  iconColor: string;
  bgColor: string;
  format?: "currency";
}

const STAT_CARDS: StatCardDef[] = [
  {
    key: "totalUsers",
    label: "Utilisateurs",
    icon: Users,
    iconColor: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
  {
    key: "totalOrganizations",
    label: "Organisations",
    icon: Building2,
    iconColor: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-900/20",
  },
  {
    key: "totalEvents",
    label: "Événements",
    icon: CalendarDays,
    iconColor: "text-purple-600",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
  },
  {
    key: "totalRegistrations",
    label: "Inscriptions",
    icon: Users,
    iconColor: "text-orange-600",
    bgColor: "bg-orange-50 dark:bg-orange-900/20",
  },
  {
    key: "totalRevenue",
    label: "Revenus",
    icon: Wallet,
    iconColor: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    format: "currency",
  },
  {
    key: "activeVenues",
    label: "Lieux actifs",
    icon: MapPin,
    iconColor: "text-teal-600",
    bgColor: "bg-teal-50 dark:bg-teal-900/20",
  },
];

export default function AdminPage() {
  const tCommon = useTranslations("common");
  const { data: stats, isLoading } = useAdminStats();
  void tCommon; // reserved for future string swaps (I1d long-tail)

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Vue d&apos;ensemble</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— ADMINISTRATION"
        title="Administration de la plateforme"
        subtitle="Vue d'ensemble de l'activité de la plateforme."
        size="hero"
        as="h1"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon;
          const rawValue = (stats?.data as Record<string, number> | undefined)?.[card.key];
          const displayValue =
            card.format === "currency"
              ? formatCurrency(Number(rawValue ?? 0))
              : String(rawValue ?? 0);

          return (
            <Card key={card.key}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`${card.bgColor} p-2 rounded-lg`}>
                    <Icon className={`h-5 w-5 ${card.iconColor}`} />
                  </div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                </div>
                {isLoading ? (
                  <Skeleton variant="text" className="h-8 w-24" />
                ) : (
                  <p className="text-2xl font-bold text-foreground">{displayValue}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
