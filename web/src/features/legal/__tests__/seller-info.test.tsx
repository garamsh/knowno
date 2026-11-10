import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "@/app/login/page";
import PrivacyPage from "@/app/(legal)/privacy/page";
import TermsPage from "@/app/(legal)/terms/page";
import { render } from "@/testing/render";

import { sellerDetails } from "../seller-details";
import { SellerInfo } from "../seller-info";

describe("the seller's details", () => {
  it("show every required item and link to 공정거래위원회's lookup page", async () => {
    await render(SellerInfo, {});

    const footer = screen.getByRole("contentinfo", { name: "사업자 정보" });
    for (const label of [
      "상호",
      "대표자",
      "주소",
      "전화번호",
      "이메일",
      "사업자등록번호",
      "통신판매업 신고번호",
    ]) {
      expect(screen.getByText(label, { selector: "dt" })).toBeInTheDocument();
    }
    for (const value of [
      sellerDetails.businessName,
      sellerDetails.representative,
      sellerDetails.address,
      sellerDetails.phone,
      sellerDetails.email,
      sellerDetails.businessRegistrationNumber,
      sellerDetails.mailOrderReportNumber,
    ]) {
      expect(footer).toHaveTextContent(value);
    }
    expect(screen.getByRole("link", { name: "사업자정보확인" })).toHaveAttribute(
      "href",
      sellerDetails.ftcLookupUrl,
    );
  });

  it.each([
    ["the terms", TermsPage],
    ["the privacy policy", PrivacyPage],
  ] as const)("appear on %s", async (_name, page) => {
    await render(page, {});

    expect(screen.getByRole("contentinfo", { name: "사업자 정보" })).toBeInTheDocument();
  });

  it("appear on the sign-in page", async () => {
    await render(LoginPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });

    expect(screen.getByRole("contentinfo", { name: "사업자 정보" })).toBeInTheDocument();
  });
});
