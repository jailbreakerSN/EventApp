import Link from "next/link";
import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-12">
      <Link href="/" className="mb-8">
        <Image src="/logo-color.svg" alt="Teranga Event" width={160} height={95} className="h-14 w-auto" priority />
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
