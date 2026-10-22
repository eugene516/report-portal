"use client";
// 지금 보고 있는 리포트를 인쇄 · PDF로 저장 (브라우저 인쇄 창에서 'PDF로 저장' 선택). 인쇄용 화면은 globals.css @media print
export default function PrintButton() {
  return <button className="btn sm print-btn" onClick={() => window.print()} title="인쇄 창에서 대상을 'PDF로 저장'으로 고르세요">⤓ PDF로 저장</button>;
}
