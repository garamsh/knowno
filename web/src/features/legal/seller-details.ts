/**
 * The seller's business details that 전자상거래법 제10조 and 제13조 require the site to show.
 * Every field but `email` and the lookup link is a placeholder until the owner supplies the value.
 */
// TODO(owner): replace each bracketed placeholder with the registered business's value.
export const sellerDetails = {
  businessName: "[상호]",
  representative: "[대표자 성명]",
  address: "[사업장 주소]",
  phone: "[전화번호]",
  email: "sauce@garam.sh",
  businessRegistrationNumber: "[사업자등록번호]",
  mailOrderReportNumber: "[통신판매업 신고번호]",
  /** 공정거래위원회's 통신판매사업자 등록현황 page, where a buyer looks the seller up. */
  ftcLookupUrl: "https://www.ftc.go.kr/www/bizContents.do?key=253",
} as const;
