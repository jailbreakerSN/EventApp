import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

/* ------------------------------------------------------------------ */
/*  Breadcrumb (root nav)                                              */
/* ------------------------------------------------------------------ */

function Breadcrumb({ className, ...props }: React.ComponentPropsWithoutRef<"nav">) {
  return <nav aria-label="Breadcrumb" className={cn("", className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/*  BreadcrumbList                                                     */
/* ------------------------------------------------------------------ */

function BreadcrumbList({ className, ...props }: React.ComponentPropsWithoutRef<"ol">) {
  return (
    <ol
      className={cn(
        "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  BreadcrumbItem                                                     */
/* ------------------------------------------------------------------ */

function BreadcrumbItem({ className, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  BreadcrumbLink                                                     */
/* ------------------------------------------------------------------ */

function BreadcrumbLink({ className, ...props }: React.ComponentPropsWithoutRef<"a">) {
  return (
    <a
      className={cn(
        "text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  BreadcrumbPage (current / non-linked)                              */
/* ------------------------------------------------------------------ */

function BreadcrumbPage({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      aria-current="page"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  BreadcrumbSeparator                                                */
/* ------------------------------------------------------------------ */

function BreadcrumbSeparator({ className, children, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:h-3.5 [&>svg]:w-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
};
