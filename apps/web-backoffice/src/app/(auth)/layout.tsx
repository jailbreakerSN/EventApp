/**
 * Server-safe auth route-group layout.
 *
 * The shared editorial shell (split navy hero + form column) lives in
 * `./_components/auth-shell.tsx` and is composed by each page so copy
 * (hero title / lead / kicker) can vary. This layout stays a thin
 * pass-through to keep metadata handling per page.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
