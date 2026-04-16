"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
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

export function ForgotPasswordForm() {
  const tAuth = useTranslations("auth");
  const tValidation = useTranslations("auth.validation");
  const { resetPassword } = useAuth();
  const [success, setSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
            message: tValidation("invalidEmail"),
          }),
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
    defaultValues: { email: "" },
    resolver: zodResolver(schema),
  });

  const onSubmit = async ({ email }: FormValues) => {
    try {
      await resetPassword(email);
    } catch {
      // Security best practice: don't reveal whether the email exists.
    }
    setSubmittedEmail(email);
    setSuccess(true);
  };

  const emailState: "idle" | "valid" | "error" = errors.email
    ? "error"
    : touchedFields.email && dirtyFields.email
      ? "valid"
      : "idle";

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
        <CardTitle className="text-2xl">{tAuth("forgotPasswordTitle")}</CardTitle>
        <CardDescription>{tAuth("forgotPasswordSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="rounded-md bg-green-500/10 p-4 text-sm text-green-700 dark:text-green-400">
            {tAuth("resetEmailSent", { email: submittedEmail })}
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              label={tAuth("email")}
              htmlFor="email"
              required
              error={errors.email?.message}
              state={emailState}
            >
              <Input
                id="email"
                type="email"
                placeholder={tAuth("emailPlaceholder")}
                autoComplete="email"
                {...register("email")}
              />
            </FormField>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? tAuth("sendingResetLink") : tAuth("sendResetLink")}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-teranga-gold-dark hover:underline">
            {tAuth("backToLogin")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
