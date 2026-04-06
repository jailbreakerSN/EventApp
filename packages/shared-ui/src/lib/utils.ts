import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string, locale = "fr-SN"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "Africa/Dakar",
  }).format(new Date(dateStr));
}

export function formatDateTime(dateStr: string, locale = "fr-SN"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Dakar",
  }).format(new Date(dateStr));
}

export function formatCurrency(amount: number, currency = "XOF", locale = "fr-SN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
