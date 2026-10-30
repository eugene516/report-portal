"use client";
// 할일 화면 공통 상태 · 동작 (TodoApp 이 채워 준다)
import { createContext, useContext } from "react";
import type { Card, Column, Item, Member, Routine, RoutineLog } from "./types";

export type Kind = "card" | "item";
export type Filter = "mine" | "all" | string;   // 그 밖의 값은 멤버 id

export type Todo = {
  today: string; meId: string; myMemberId: string | null; isAdmin: boolean;
  members: Member[]; columns: Column[]; cards: Card[]; items: Item[]; routines: Routine[]; logs: RoutineLog[];
  clients: { id: string; name: string }[];
  filter: Filter;
  memberColor: (id: string | null) => string;
  pass: (t: Card | Item) => boolean;
  laterColumn: Column | undefined;
  open: (kind: Kind, id: string) => void;
  // 카드 · 세부 항목
  addCard: (columnId: string, title: string) => Promise<boolean>;
  addItem: (cardId: string, title: string) => Promise<boolean>;
  patchCard: (id: string, p: Partial<Card>) => Promise<boolean>;
  patchItem: (id: string, p: Partial<Item>) => Promise<boolean>;
  toggle: (kind: Kind, id: string) => void;
  removeCard: (id: string) => Promise<boolean>;
  removeItem: (id: string) => Promise<boolean>;
  // 열
  addColumn: (name: string, color: string) => Promise<boolean>;
  patchColumn: (id: string, p: Partial<Column>) => Promise<boolean>;
  moveColumn: (id: string, dir: -1 | 1) => void;
  removeColumn: (c: Column) => void;
  // 루틴
  canEditRoutine: (r: Routine) => boolean;
  addRoutine: (title: string) => Promise<boolean>;
  renameRoutine: (r: Routine, title: string) => void;
  removeRoutine: (r: Routine) => void;
  setRoutineLog: (r: Routine, status: RoutineLog["status"] | null) => void;
};

export const TodoCtx = createContext<Todo | null>(null);
export const useTodo = () => useContext(TodoCtx)!;
