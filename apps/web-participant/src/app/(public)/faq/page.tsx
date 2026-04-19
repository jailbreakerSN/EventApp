import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SectionHeader } from "@teranga/shared-ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("faq");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function FaqPage() {
  const t = await getTranslations("faq");
  const upcomingKeys = [
    "register",
    "qr",
    "cancel",
    "contact",
    "payments",
    "confirmationEmail",
  ] as const;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        {t("back")}
      </Link>

      <SectionHeader
        kicker={t("kicker")}
        title={t("title")}
        subtitle={t("subtitle")}
        size="hero"
        as="h1"
      />

      <div className="space-y-8 text-foreground leading-relaxed">
        <section className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6">
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            {t("comingSoonHeading")}
          </h2>
          <p className="text-muted-foreground">{t("comingSoonBody")}</p>
          <p className="text-muted-foreground mt-3">
            {t("contactPrefix")}{" "}
            <a href="mailto:contact@teranga.sn" className="text-primary hover:underline">
              contact@teranga.sn
            </a>
          </p>
        </section>

        <section>
          <h2 className="font-serif-display text-2xl font-semibold mb-3">
            {t("upcomingSectionsHeading")}
          </h2>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            {upcomingKeys.map((key) => (
              <li key={key}>{t(`upcomingSections.${key}`)}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
