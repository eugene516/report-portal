"use client";
// 문의관리 화면 공용 상태 · 동작 (InquiryApp 이 채운다)
import { createContext, useContext } from "react";
import type { EventKind, Inquiry, IqEvent, Settings, Stage, StaffUser } from "./model";

export type NewFields = Pick<Inquiry, "company" | "person" | "phone" | "email" | "channel" | "referrer" | "services" | "budget" | "industry" | "region" | "summary" | "raw" | "owner">;

export type IqApi = {
  today: string; meId: string; isAdmin: boolean;
  settings: Settings; staff: StaffUser[]; cards: Inquiry[]; events: IqEvent[];
  nameOf: (id: string | null) => string;
  canManage: (c: Inquiry) => boolean;          // 단계 · 담당 · 계약 처리 (담당 · 관리자 · 담당 미정)
  canDelete: (c: Inquiry) => boolean;
  openCard: (id: string) => void;
  openNew: () => void;
  patch: (c: Inquiry, p: Partial<Inquiry>) => Promise<boolean>;
  setStage: (c: Inquiry, s: Stage) => Promise<boolean>;
  addEvent: (c: Inquiry, kind: EventKind, body: string) => Promise<boolean>;
  removeEvent: (e: IqEvent) => Promise<void>;
  removeCard: (c: Inquiry) => Promise<boolean>;
  createCard: (f: NewFields) => Promise<Inquiry | null>;
  saveSettings: (p: Partial<Settings>) => Promise<boolean>;
};

export const IqCtx = createContext<IqApi | null>(null);
export const useIq = () => useContext(IqCtx)!;
