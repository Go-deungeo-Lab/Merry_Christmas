// 하루의 기준은 서버가 계산한 KST 날짜다. 클라이언트는 날짜를 보내지 않는다.

export const SERVICE_START = "2026-11-12";
export const SERVICE_END = "2026-12-31";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// YYYY-MM-DD (KST)
export function todayKst(now = Date.now()): string {
  // 로컬 개발에서 날짜를 바꿔 가며 테스트하기 위한 값. 운영 빌드에서는 무시한다.
  const override = process.env.NODE_ENV !== "production" ? process.env.DEV_TODAY : undefined;
  if (override) return override;
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export type Period = "before" | "open" | "after";

export function servicePeriod(today: string): Period {
  if (today < SERVICE_START) return "before";
  if (today > SERVICE_END) return "after";
  return "open";
}
