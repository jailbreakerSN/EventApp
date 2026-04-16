"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { getAndClearRedirectUrl } from "@/components/auth-guard";
import { ThemeLogo } from "@/components/theme-logo";
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  FormField,
} from "@teranga/shared-ui";

function safeRedirect(url: string | null): string {
  if (!url) return "/events";
  // Only allow relative paths starting with / (block protocol-relative URLs like //evil.com)
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/events";
}

export function LoginForm() {
  const tAuth = useTranslations("auth");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Schema rebuilt per-render so Zod error messages translate with the
  // active locale — cheap on render, keeps the form fully reactive to
  // language switches without a full reload.
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
            message: tValidation("invalidEmail"),
          }),
        password: z.string().min(6, { message: tValidation("passwordMin6") }),
      }),
    [tValidation],
  );

  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields, dirtyFields, isSubmitting },
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(schema),
  });

  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const fieldState = (name: keyof FormValues): "idle" | "valid" | "error" => {
    if (errors[name]) return "error";
    if (touchedFields[name] && dirtyFields[name]) return "valid";
    return "idle";
  };

  const onSubmit = async ({ email, password }: FormValues) => {
    setError(null);
    try {
      await login(email, password);
      const savedUrl = safeRedirect(getAndClearRedirectUrl());
      router.push(savedUrl !== "/events" ? savedUrl : redirectTo);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      if (
        raw.includes("invalid-credential") ||
        raw.includes("wrong-password") ||
        raw.includes("user-not-found")
      ) {
        setError(tErrors("invalidCredentials"));
      } else if (raw) {
        // Firebase / network error — pass through raw message if present.
        setError(raw);
      } else {
        setError(tErrors("loginGeneric"));
      }
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      const savedUrl = safeRedirect(getAndClearRedirectUrl());
      router.push(savedUrl !== "/events" ? savedUrl : redirectTo);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      setError(raw || tErrors("loginGoogle"));
    } finally {
      setGoogleLoading(false);
    }
  };

  const loading = isSubmitting || googleLoading;

  return (
    <Card>
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 block">
          <ThemeLogo
            width={140}
            height={83}
            className="h-14 w-auto mx-auto sm:h-16 md:h-20"
            priority
          />
        </Link>
        <CardTitle className="text-2xl">{tAuth("login")}</CardTitle>
        <CardDescription>{tAuth("loginSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <FormField
            label={tAuth("email")}
            required
            htmlFor="email"
            error={errors.email?.message}
            state={fieldState("email")}
          >
            <Input
              id="email"
              type="email"
              placeholder={tAuth("emailPlaceholder")}
              autoComplete="email"
              {...register("email")}
            />
          </FormField>

          <FormField
            label={tAuth("password")}
            required
            htmlFor="password"
            error={errors.password?.message}
            state={fieldState("password")}
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
          </FormField>

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {tAuth("forgotPassword")}
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {isSubmitting ? tAuth("loginButtonLoading") : tAuth("loginButton")}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">{tAuth("or")}</span>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
          {tAuth("continueWithGoogle")}
        </Button>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {tAuth("noAccount")}{" "}
          <Link
            href={`/register?redirect=${encodeURIComponent(redirectTo)}`}
            className="font-medium text-teranga-gold-dark hover:underline"
          >
            {tAuth("createAccount")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
