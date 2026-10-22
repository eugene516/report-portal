// 화면 이동 중 표시 (서버 응답을 기다리는 동안 바로 반응하도록)
export default function Loading() {
  return (
    <div className="ops">
      <div className="loading-bar" aria-label="불러오는 중" />
      <p className="faint mt">불러오는 중…</p>
    </div>
  );
}
