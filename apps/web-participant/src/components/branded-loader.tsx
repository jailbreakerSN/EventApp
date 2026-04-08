"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { LogoLoader } from "@teranga/shared-ui";

interface BrandedLoaderProps {
  label?: string;
  className?: string;
}

export function BrandedLoader({ label, className }: BrandedLoaderProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const src = mounted && resolvedTheme === "dark" ? "/logo-icon-white.svg" : "/logo-icon.svg";

  return <LogoLoader src={src} label={label} className={className} />;
}
