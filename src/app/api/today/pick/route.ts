import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyOffers, dailyPicks } from "@/db/schema";
import { apiError, currentUserId, unauthorized } from "@/lib/api";
import { SERVICE_START, servicePeriod, todayKst } from "@/lib/kst";
import { formatDate } from "@/lib/labels";
import { drawFortuneId, findPick } from "@/lib/picks";

// body { index: 0~2 }. 아이템 내용은 서버에 저장된 후보에서 꺼내고, 운세는 이때 정한다.
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (userId === null) return unauthorized();

  const today = todayKst();
  const period = servicePeriod(today);
  if (period !== "open") {
    return apiError(403, `period_${period}`, period === "before" ? `${formatDate(SERVICE_START)}에 시작해요.` : "올해 운세는 끝났어요.");
  }

  // 이미 골랐다면 같은 결과를 돌려준다 (중복 요청, 새로고침)
  const existing = await findPick(userId, today);
  if (existing) return NextResponse.json({ today, pick: existing });

  const body = await request.json().catch(() => null);
  const index = body?.index;
  if (!Number.isInteger(index) || index < 0 || index > 2) {
    return apiError(400, "invalid_index", "후보 번호는 0, 1, 2 중 하나여야 해요.");
  }

  const [offer] = await db
    .select({ candidates: dailyOffers.candidates })
    .from(dailyOffers)
    .where(and(eq(dailyOffers.userId, userId), eq(dailyOffers.date, today)));
  const candidate = offer?.candidates[index];
  if (!candidate) return apiError(409, "no_offer", "오늘의 후보를 먼저 열어 주세요.");

  const fortuneId = await drawFortuneId(userId);
  if (fortuneId === null) return apiError(503, "no_fortunes", "운세를 준비하고 있어요. 잠시 뒤에 다시 시도해 주세요.");

  const [x, y, z] = candidate.pos;
  // (user_id, date) 기본키 덕분에 동시에 두 번 눌러도 하나만 저장된다
  await db
    .insert(dailyPicks)
    .values({
      userId,
      date: today,
      itemType: candidate.itemType,
      color: candidate.color,
      variant: candidate.variant,
      posX: x,
      posY: y,
      posZ: z,
      fortuneId,
    })
    .onConflictDoNothing();

  const pick = await findPick(userId, today);
  return NextResponse.json({ today, pick });
}
