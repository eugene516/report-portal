"use client";
// 광고주 현황 표의 한 줄: 기본은 간략히 보기, "자세히 보기"를 누르면 바로 아래에 요약 그래프가 펼쳐진다.
// 펼쳐지는 내용(detail)은 서버에서 그려 넘겨받는다.
import { useState } from "react";

export default function ExpandRow({ cells, actions, detail, colSpan }: { cells: React.ReactNode; actions: React.ReactNode; detail: React.ReactNode; colSpan: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={open ? "x-open" : ""}>
        {cells}
        <td className="r">
          <div className="actions">
            <button className={`btn sm ${open ? "primary" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "접기 ▴" : "자세히 보기 ▾"}
            </button>
            {actions}
          </div>
        </td>
      </tr>
      {open && <tr className="x-row"><td colSpan={colSpan}>{detail}</td></tr>}
    </>
  );
}
