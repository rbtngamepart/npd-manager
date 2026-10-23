import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage, SERVICE_NAME } from "@/components/LegalPage";

export const metadata: Metadata = { title: `개인정보처리방침 · ${SERVICE_NAME}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보처리방침">
      <p>
        {SERVICE_NAME}(이하 &lsquo;서비스&rsquo;)는 레드버튼 게임파트가 사내 프로젝트 일정·진행 관리를 위해 운영하는 내부 업무용 웹사이트입니다.
        서비스는 이용자의 개인정보를 아래와 같이 처리합니다.
      </p>

      <h2>1. 수집하는 항목</h2>
      <ul>
        <li>로그인 시: 이메일 주소, 이름(Google 계정 이름 또는 이메일 앞부분)</li>
        <li>관리자가 입력하는 정보: 소속 부서, 사용 권한</li>
        <li>서비스 이용 중 작성한 내용: 프로젝트·단계 일정, 진행 메모와 작성 시각</li>
      </ul>
      <p>Google 로그인 시 이메일과 기본 프로필(이름) 외의 정보(연락처, 드라이브, 메일 내용 등)는 요청하거나 수집하지 않습니다.</p>

      <h2>2. 이용 목적</h2>
      <ul>
        <li>본인 확인 및 로그인</li>
        <li>사내 사용 권한(열람·편집) 관리</li>
        <li>프로젝트 진행 기록에 작성자 표시</li>
      </ul>
      <p>수집한 정보는 위 목적 외로 사용하지 않으며, 광고·마케팅에 이용하거나 외부에 판매·제공하지 않습니다.</p>

      <h2>3. 보관 및 파기</h2>
      <p>
        정보는 이용자가 서비스 이용 권한을 가진 동안 보관하며, 퇴사·권한 해제 등으로 더 이상 필요하지 않거나 이용자가 삭제를 요청하면 지체 없이 삭제합니다.
        단, 업무 기록(진행 메모)은 회사 업무 이력으로서 작성자 표시 없이 남을 수 있습니다.
      </p>

      <h2>4. 처리 위탁</h2>
      <ul>
        <li>Supabase Inc. — 데이터베이스 및 로그인 처리</li>
        <li>Netlify, Inc. — 웹사이트 호스팅</li>
        <li>Google LLC — Google 계정 로그인</li>
      </ul>

      <h2>5. 이용자의 권리</h2>
      <p>이용자는 언제든지 본인 정보의 열람·수정·삭제를 요청할 수 있습니다. 이름과 부서는 사이트의 &lsquo;내 정보&rsquo; 메뉴에서 직접 수정할 수 있습니다.</p>

      <h2>6. 문의</h2>
      <p>
        개인정보 관련 문의: <a className="text-brand-600 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> (레드버튼 게임파트)
      </p>
    </LegalPage>
  );
}
