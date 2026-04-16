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
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/events";
}

export function RegisterForm() {
  const tAuth = useTranslations("auth");
  const tValidation = useTranslations("auth.validation");
  const tErrors = useTranslations("auth.errors");
  const { register: registerUser, loginWithGoogle } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const registerSchema = useMemo(
    () =>
      z.object({
        displayName: z
          .string()
          .trim()
          .min(1, { message: tValidation("required") }),
        email: z
          .string()
          .trim()
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
            message: tValidation("invalidEmail"),
          }),
        password: z
          .string()
          .min(8, { message: tValidation("passwordMin8") })
          .regex(/[A-Z]/, { message: tValidation("passwordUppercase") })
          .regex(/[0-9]/, { message: tValidation("passwordDigit") }),
      }),
    [tValidation],
  );

  type RegisterFormValues = z.infer<typeof registerSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields, isSubmitting, dirtyFields },
  } = useForm<RegisterFormValues>({
    mode: "onBlur",
    defaultValues: { displayName: "", email: "", password: "" },
    resolver: zodResolver(registerSchema),
  });

  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const fieldState = (name: keyof RegisterFormValues): "idle" | "valid" | "error" => {
    if (errors[name]) return "error";
    if (touchedFields[name] && dirtyFields[name]) return "valid";
    return "idle";
  };

  const onSubmit = async (values: RegisterFormValues) => {
    setError(null);
    try {
      await registerUser(values.email, values.password, values.displayName);
      router.push("/verify-email");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      if (raw.includes("email-already-in-use")) {
        setError(tErrors("emailInUse"));
      } else if (raw.includes("weak-password")) {
        setError(tErrors("weakPassword"));
      } else if (raw) {
        setError(raw);
      } else {
        setError(tErrors("registerGeneric"));
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
        <CardTitle className="text-2xl">{tAuth("createAccount")}</CardTitle>
        <CardDescription>{tAuth("registerSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <FormField
            label={tAuth("fullName")}
            required
            htmlFor="displayName"
            error={errors.displayName?.message}
            state={fieldState("displayName")}
          >
            <Input
              id="displayName"
              type="text"
              placeholder={tAuth("fullNamePlaceholder")}
              autoComplete="name"
              {...register("displayName")}
            />
          </FormField>

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
            hint={tAuth("passwordHint")}
          >
            <Input
              id="password"
              type="password"
              placeholder={tAuth("passwordPlaceholder")}
              autoComplete="new-password"
              minLength={8}
              {...register("password")}
            />
          </FormField>

          <Button type="submit" className="w-full" disabled={loading}>
            {isSubmitting ? tAuth("registerButtonLoading") : tAuth("registerButton")}
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
          {tAuth("alreadyAccount")}{" "}
          <Link
            href={`/login?redirect=${encodeURIComponent(redirectTo)}`}
            className="font-medium text-teranga-gold-dark hover:underline"
          >
            {tAuth("login")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
