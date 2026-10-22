"use client";
// 내부용 화면 틀: 상단 바(햄버거) + 좌측 메뉴 + (관리자) 직원 이름 아래로 펼쳐지는 담당 업체 하위 메뉴
// - 넓은 화면: 좌측 메뉴 고정. 햄버거로 접고 펼친다(쿠키에 기억).
// - 광고주 리포트 화면(/admin/clients/{id})은 자체 좌측 메뉴가 있어 기본으로 접어 둔다.
// - 좁은 화면: 햄버거를 누르면 메뉴가 화면 위로 열린다.
// 메뉴는 화면 표시용일 뿐이고, 각 화면은 서버와 DB가 권한을 다시 확인한다.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

type NavClient = { id: string; name: string; primary: boolean };
type NavStaff = { id: string; name: string; role: "owner" | "admin" | "staff"; clients: NavClient[] };
type Props = {
  me: { name: string; role: "owner" | "admin" | "staff" };
  staff: NavStaff[];          // 관리자 이상만 채워짐
  myClients: NavClient[];     // 직원: 내 담당 광고주
  children: React.ReactNode;
};

const ROLE = { owner: "오너", admin: "관리자", staff: "직원" } as const;
const NAV_COOKIE = "rp_nav";   // "c" = 넓은 화면에서 메뉴 접음 (서버가 읽어 첫 화면부터 같은 모양으로 그린다)

export default function AdminFrame({ me, staff, myClients, navCollapsed, children }: Props & { navCollapsed: boolean }) {
  const path = usePathname();
  const sp = useSearchParams();
  const isAdmin = me.role === "owner" || me.role === "admin";
  const inReport = /^\/admin\/clients\/[0-9a-f-]{36}(\/|$)/.test(path) && !path.endsWith("/settings") && !path.endsWith("/upload");
  const [pref, setPref] = useState(navCollapsed);          // 일반 화면에서 접힘 (쿠키에 기억)
  const [reportOpen, setReportOpen] = useState(false);     // 리포트 화면에서 펼침 (기본 접힘)
  const [mobileAt, setMobileAt] = useState<string | null>(null);   // 좁은 화면: 연 화면 주소 (다른 화면으로 가면 자동으로 닫힘)
  const [openStaff, setOpenStaff] = useState<string[]>(sp.get("staff") ? [sp.get("staff")!] : []);   // 펼친 직원 (여러 명 동시에 가능)
  const collapsed = inReport ? !reportOpen : pref;
  const mobileOpen = mobileAt === path;

  function toggle() {
    if (window.matchMedia("(max-width: 900px)").matches) { setMobileAt(mobileOpen ? null : path); return; }
    if (inReport) { setReportOpen(!reportOpen); return; }
    document.cookie = `${NAV_COOKIE}=${pref ? "o" : "c"}; path=/admin; max-age=31536000; samesite=lax`;
    setPref(!pref);
  }

  const clientId = path.match(/^\/admin\/(?:progress|clients)\/([0-9a-f-]{36})/)?.[1];
  const on = (href: string, exact = true) => (exact ? path === href : path.startsWith(href)) ? "on" : "";

  return (
    <>
      <header className="admin-bar">
        <div className="row">
          <button className="burger" onClick={toggle} aria-label="메뉴 열기·닫기" aria-expanded={collapsed ? mobileOpen : true}>
            <span /><span /><span />
          </button>
          <Link href="/admin" className="admin-brand">리포트 포털</Link>
          <span className="faint hide-s">믿는구석 · 내부용</span>
        </div>
        <div className="row">
          {isAdmin && <Link href="/admin/invite" className="btn sm primary hide-s">직원 초대</Link>}
          <span className="faint hide-s">{me.name} ({ROLE[me.role]})</span>
          <Link href="/admin/account" className="btn sm">내 정보 수정</Link>
          <form action="/auth/signout" method="post"><button className="btn sm">로그아웃</button></form>
        </div>
      </header>

      <div className={`adm ${collapsed ? "collapsed" : ""} ${mobileOpen ? "m-open" : ""}`}>
        {mobileOpen && <div className="adm-dim" onClick={() => setMobileAt(null)} />}
        <aside className="adm-nav" aria-label="내부 메뉴">
          <nav className="nav">
            <Link href="/admin" className={on("/admin")}>대시보드</Link>
            <Link href="/admin/clients" className={sp.get("staff") ? "" : on("/admin/clients")}>광고주 현황</Link>
            <Link href="/admin/tasks" className={on("/admin/tasks")}>업무 확인</Link>
          </nav>

          {isAdmin ? (
            <div className="nav-sec">
              <div className="nav-sec-h"><span>직원</span><Link href="/admin/invite" className="nav-add" title="직원 추가 (초대)">+ 추가</Link></div>
              <nav className="nav">
                {staff.map((s) => {
                  const open = openStaff.includes(s.id);
                  return (
                    <div key={s.id}>
                      <button className={`nav-btn ${open ? "open" : ""}`} aria-expanded={open}
                        onClick={() => setOpenStaff(open ? openStaff.filter((x) => x !== s.id) : [...openStaff, s.id])}>
                        <span className="nav-t">{s.name}{s.role !== "staff" && <span className="faint"> · {ROLE[s.role]}</span>}</span>
                        <span className="cnt">{s.clients.length}<span className="chev" aria-hidden="true">▾</span></span>
                      </button>
                      {open && (
                        <div className="subnav">
                          <Link href={`/admin/clients?staff=${s.id}`} className={path === "/admin/clients" && sp.get("staff") === s.id ? "on" : ""}>한눈에 보기</Link>
                          {s.clients.length === 0 && <span className="faint pad-x">담당 업체 없음</span>}
                          {s.clients.map((c) => (
                            <Link key={c.id} href={`/admin/progress/${c.id}?staff=${s.id}`} className={clientId === c.id && sp.get("staff") === s.id ? "on" : ""}>
                              <span className="nav-t">{c.name}</span><span className="cnt">{c.primary ? "주" : "보조"}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          ) : (
            <div className="nav-sec">
              <div className="nav-sec-h"><span>내 담당 광고주</span></div>
              <nav className="nav">
                {myClients.length === 0 && <span className="faint pad-x">담당 광고주가 없습니다</span>}
                {myClients.map((c) => (
                  <Link key={c.id} href={`/admin/progress/${c.id}`} className={clientId === c.id ? "on" : ""}>
                    <span className="nav-t">{c.name}</span>{c.primary && <span className="cnt">주</span>}
                  </Link>
                ))}
              </nav>
            </div>
          )}

          <div className="nav-sec">
            <div className="nav-sec-h"><span>관리</span></div>
            <nav className="nav">
              <Link href="/admin/clients/new" className={on("/admin/clients/new")}>+ 새 광고주</Link>
              {isAdmin && <Link href="/admin/assignments" className={on("/admin/assignments")}>담당 직원 배정</Link>}
              {isAdmin && <Link href="/admin/staff" className={on("/admin/staff")}>직원 · 권한 관리</Link>}
              {isAdmin && <Link href="/admin/settings/naver-keys" className={on("/admin/settings", false)}>API 키 현황</Link>}
            </nav>
          </div>
        </aside>

        <div className="adm-main">{children}</div>
      </div>
    </>
  );
}
