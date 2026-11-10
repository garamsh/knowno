import { sellerDetails } from "./seller-details";

const rows = [
  ["상호", sellerDetails.businessName],
  ["대표자", sellerDetails.representative],
  ["주소", sellerDetails.address],
  ["전화번호", sellerDetails.phone],
  ["이메일", sellerDetails.email],
  ["사업자등록번호", sellerDetails.businessRegistrationNumber],
  ["통신판매업 신고번호", sellerDetails.mailOrderReportNumber],
] as const;

/** The seller's business details and the link to 공정거래위원회's page for looking them up. */
export function SellerInfo() {
  return (
    <footer aria-label="사업자 정보" className="flex flex-col gap-1 text-caption text-muted">
      <dl className="flex flex-col gap-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-x-1">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <a
        href={sellerDetails.ftcLookupUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-tap-target items-center underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        사업자정보확인
      </a>
    </footer>
  );
}
