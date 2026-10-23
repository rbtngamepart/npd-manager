import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage, SERVICE_NAME } from "@/components/LegalPage";

export const metadata: Metadata = { title: `이용약관 · ${SERVICE_NAME}` };

export default function TermsPage() {
  return (
    <LegalPage title="이용약관">
      <h2>1. 목적</h2>
      <p>이 약관은 레드버튼 게임파트가 운영하는 {SERVICE_NAME}(이하 &lsquo;서비스&rsquo;)의 이용 조건을 정합니다.</p>

      <h2>2. 이용 대상</h2>
      <p>서비스는 레드버튼 임직원 및 회사가 초대한 협업 담당자만 이용할 수 있는 사내 업무용 서비스입니다. 관리자의 초대 또는 승인을 받은 계정만 내용을 열람할 수 있습니다.</p>

      <h2>3. 이용자의 의무</h2>
      <ul>
        <li>본인 계정으로만 로그인하며, 계정을 타인과 공유하지 않습니다.</li>
        <li>서비스에서 열람한 회사 업무 정보를 외부에 유출하지 않습니다.</li>
        <li>부여받은 권한 범위 안에서만 프로젝트 정보를 수정합니다.</li>
      </ul>

      <h2>4. 권한 관리</h2>
      <p>관리자는 업무상 필요에 따라 이용자의 열람·편집 권한을 부여하거나 해제할 수 있습니다.</p>

      <h2>5. 서비스 변경 및 중단</h2>
      <p>서비스는 내부 업무용으로, 회사 사정에 따라 기능이 변경되거나 운영이 중단될 수 있습니다.</p>

      <h2>6. 문의</h2>
      <p>
        <a className="text-brand-600 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
