// 업무관리 · 할일: 오늘 / 보드 (지금 보는 사람 = 로그인한 직원)
// 카드 · 세부 항목은 직원 누구나 추가 · 수정 · 완료 · 삭제, 열 삭제는 오너 · 관리자만,
// 루틴은 주인과 오너 · 관리자만 바꾼다 (DB 규칙이 다시 확인)
import { isAdminRole, requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import { kstDate } from "@/lib/month";
import TodoApp from "./todo/TodoApp";
import { CARD_COLS, ITEM_COLS, type Card, type Column, type Item, type Member, type Routine, type RoutineLog } from "./todo/types";

export const metadata = { title: "할일 · 리포트 포털" };
export const dynamic = "force-dynamic";

// 완료 카드는 최근 30일치, 루틴 기록은 연속 계산에 쓸 120일치만 불러온다
const DONE_DAYS = 30, LOG_DAYS = 120;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await requireStaff();
  const db = await supabaseForStaff();
  const today = kstDate();
  const since = daysAgo(DONE_DAYS);
  const logFrom = new Date(Date.parse(`${today}T00:00:00Z`) - LOG_DAYS * 86_400_000).toISOString().slice(0, 10);

  await db.rpc("sync_deadline_tasks");   // 계약 마감 3일 전 항목을 주담당 직원 할 일로 올린다 (예약 작업과 같은 함수)
  const { data: myMember } = await db.rpc("todo_my_member");   // 로그인한 직원의 멤버 (없으면 만든다)

  const nested = `${CARD_COLS}, todo_items(${ITEM_COLS})`;
  const [members, columns, open, done, routines, logs, clients] = await Promise.all([
    db.from("task_members").select("id, name, user_id, job_title, sort").order("sort").order("created_at"),
    db.from("todo_columns").select("id, name, color, is_later, sort").order("sort").order("created_at"),
    db.from("todo_cards").select(nested).eq("done", false).order("sort").order("created_at"),
    db.from("todo_cards").select(nested).eq("done", true).gte("done_at", since).order("done_at", { ascending: false }),
    db.from("todo_routines").select("id, owner_id, title, sort, created_at").order("sort").order("created_at"),
    db.from("todo_routine_logs").select("routine_id, on_date, status").gte("on_date", logFrom),
    db.from("clients").select("id, name").order("name"),
  ]);

  // 카드와 세부 항목을 따로 나눠 넘긴다 (실시간 변경도 표마다 따로 들어온다)
  type Nested = Card & { todo_items: Item[] | null };
  const rows = [...(open.data ?? []), ...(done.data ?? [])] as unknown as Nested[];
  const cards: Card[] = rows.map((r) => { const c: Partial<Nested> = { ...r }; delete c.todo_items; return c as Card; });
  const items: Item[] = rows.flatMap((r) => r.todo_items ?? []);

  return (
    <div className="ops td-page">
      <TodoApp
        today={today}
        meId={me.userId}
        myMemberId={(myMember as string | null) ?? null}
        isAdmin={isAdminRole(me.role)}
        initialView={sp.view === "board" ? "board" : "today"}
        members={(members.data ?? []) as Member[]}
        columns={(columns.data ?? []) as Column[]}
        cards={cards}
        items={items}
        routines={(routines.data ?? []) as Routine[]}
        logs={(logs.data ?? []) as RoutineLog[]}
        clients={clients.data ?? []}
      />
    </div>
  );
}
