// 업무관리: 상단 탭(할일 · 문의관리) 아래에 각 화면
import WorkTabs from "./WorkTabs";

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkTabs />
      {children}
    </>
  );
}
