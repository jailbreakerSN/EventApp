"use client";

import Link from "next/link";
import { use } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { Tag } from "lucide-react";
import { CouponForm } from "@/components/coupons/CouponForm";
import { useAdminCoupon } from "@/hooks/use-admin";

export default function AdminEditCouponPage(props: {
  params: Promise<{ couponId: string }>;
}) {
  const { couponId } = use(props.params);
  const { data, isLoading } = useAdminCoupon(couponId);
  const coupon = data?.data;

  return (
    <div className="space-y-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin/coupons">Coupons</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{coupon?.code ?? couponId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-3">
        <Tag className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Coupon {coupon?.code ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Modifier le libellé, la portée ou les plafonds de ce coupon. Le code, le type et la
            valeur de la remise sont figés à la création (garantit l&apos;intégrité des
            rédemptions passées).
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {!isLoading && !coupon && (
        <p className="text-sm text-destructive">Coupon introuvable.</p>
      )}
      {coupon && <CouponForm mode="edit" coupon={coupon} />}
    </div>
  );
}
