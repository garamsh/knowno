/**
 * The seller's business details that 전자상거래법 제10조 and 제13조 require the site to show.
 * `phone` is the owner's, given on 2026-11-10; `mailOrderReportNumber` is from the 통신판매업 신고증
 * issued 2026-10-24; the rest are from the business registration certificate issued 2026-11-03.
 */
export const sellerDetails = {
  businessName: "가람",
  representative: "이현우",
  address: "경기도 남양주시 가운로2길 111, 510동 301호(다산동, 경남아너스빌)",
  phone: "010-3014-1375",
  email: "sauce@garam.sh",
  businessRegistrationNumber: "605-37-70404",
  mailOrderReportNumber: "제2026-다산-0931호",
  /** 공정거래위원회's 통신판매사업자 등록현황 page, where a buyer looks the seller up. */
  ftcLookupUrl: "https://www.ftc.go.kr/www/bizContents.do?key=253",
} as const;
