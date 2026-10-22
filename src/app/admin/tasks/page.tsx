// 업무 확인: 구성원별 오늘 할 일 보드 (구글 태스크 형식 — 멤버는 가로, 업무는 멤버별 세로 목록)
// 업무는 직원 누구나 추가·수정·완료·삭제, 멤버 추가·삭제는 오너·관리자만 (DB 규칙이 다시 확인)
import { isAdminRole, requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import { kstDate } from "@/lib/month";
import TaskBoard, { type Member, type Task } from "./TaskBoard";

const COLS = "id, member_id, title, due_on, done, done_at, sort, created_at, client_id, note, repeat, auto";

// 완료 업무는 최근 7일치만 보여준다
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const metadata = { title: "업무 확인 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const me = await requireStaff();
  const db = await supabaseForStaff();
  const weekAgo = daysAgo(7);
  await db.rpc("sync_deadline_tasks");   // 계약 마감 3일 전 항목을 주담당 열에 올린다 (예약 작업과 같은 함수)
  const [members, open, done, dir, clients] = await Promise.all([
    db.from("task_members").select("id, name, user_id, sort, job_title, duty").order("sort").order("created_at"),
    db.from("team_tasks").select(COLS).eq("done", false).order("due_on", { ascending: true, nullsFirst: false }).order("sort").order("created_at"),
    db.from("team_tasks").select(COLS).eq("done", true).gte("done_at", weekAgo).order("done_at", { ascending: false }),
    db.rpc("staff_directory"),
    db.from("clients").select("id, name").order("name"),
  ]);
  return (
    <div className="ops tasks-page">
      <TaskBoard
        today={kstDate()}
        meId={me.userId}
        canManageMembers={isAdminRole(me.role)}
        members={(members.data ?? []) as Member[]}
        tasks={[...(open.data ?? []), ...(done.data ?? [])] as Task[]}
        directory={(dir.data ?? []) as { id: string; name: string; email: string }[]}
        clients={clients.data ?? []}
      />
    </div>
  );
}
