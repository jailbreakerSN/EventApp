import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  FIREBASE_PROJECT_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "Invalid Firebase project ID format"),
  FIREBASE_STORAGE_BUCKET: z.string(),

  CORS_ORIGINS: z.string().transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("noreply@teranga.events"),

  AT_API_KEY: z.string().optional(),
  AT_USERNAME: z.string().default("sandbox"),
  AT_SENDER_ID: z.string().default("Teranga"),

  QR_SECRET: z.string().min(32, "QR_SECRET must be at least 32 characters"),
  WEBHOOK_SECRET: z.string().min(16).default("dev-webhook-secret-change-in-prod"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
