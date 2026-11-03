import { BrandMark } from "@/design/brand";

/**
 * The admin host's brand: the lockup over "관리", the area's name. The lockup is read as 알아몰라
 * where [named], and is decorative where a link around it carries the name.
 */
export function AdminBrand({ named = false }: { named?: boolean }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <BrandMark mark="lockup" alt={named ? "알아몰라" : ""} className="h-7 w-auto" />
      <span className="ps-1 text-section text-muted">관리</span>
    </span>
  );
}
