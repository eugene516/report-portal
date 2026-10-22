// 직급 (DB check 와 같은 목록 · 이 순서로 정렬). 새 직원은 부장~사원 중에서 고른다.
export const JOB_TITLES = ["대표", "이사", "부장", "차장", "과장", "대리", "주임", "사원"] as const;
export const NEW_JOB_TITLES = ["부장", "차장", "과장", "대리", "주임", "사원"] as const;
export const jobRank = (t: string | null | undefined) => { const i = (JOB_TITLES as readonly string[]).indexOf(t ?? ""); return i < 0 ? 99 : i; };
