import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

export default async function RootPage() {
  const _t = await getTranslations("common"); void _t;
  redirect("/dashboard");
}
