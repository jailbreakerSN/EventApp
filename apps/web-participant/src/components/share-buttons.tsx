"use client";

import { useState } from "react";
import { Share2, MessageCircle, Facebook, Twitter, Link2, Check } from "lucide-react";
import { useTranslations } from "next-intl";

interface ShareButtonsProps {
  title: string;
  date: string;
  url: string;
  description?: string;
}

export function ShareButtons({ title, date, url, description }: ShareButtonsProps) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);

  const shareText = `${title}\n📅 ${date}\n\n${description ? description + "\n\n" : ""}${t("signupCta")}`;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`;
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">
        <Share2 className="mr-1 inline h-4 w-4" />
        {t("label")}
      </span>

      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white transition-transform hover:scale-110"
        aria-label={t("whatsapp")}
        title="WhatsApp"
      >
        <MessageCircle className="h-4 w-4" />
      </a>

      <a
        href={facebookUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1877F2] text-white transition-transform hover:scale-110"
        aria-label={t("facebook")}
        title="Facebook"
      >
        <Facebook className="h-4 w-4" />
      </a>

      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1DA1F2] text-white transition-transform hover:scale-110"
        aria-label={t("twitter")}
        title="X (Twitter)"
      >
        <Twitter className="h-4 w-4" />
      </a>

      <button
        onClick={copyLink}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform hover:scale-110"
        aria-label={copied ? t("copied") : t("copyLink")}
        title={copied ? t("copied") : t("copyLink")}
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
