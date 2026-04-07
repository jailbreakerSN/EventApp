"use client";

import { useTheme } from "next-themes";
import Image from "next/image";
import { useEffect, useState } from "react";

interface ThemeLogoProps {
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}

export function ThemeLogo({ width, height, className, priority }: ThemeLogoProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const src = mounted && resolvedTheme === "dark" ? "/logo-white.svg" : "/logo-color.svg";

  return <Image src={src} alt="Teranga Event" width={width} height={height} className={className} priority={priority} />;
}
