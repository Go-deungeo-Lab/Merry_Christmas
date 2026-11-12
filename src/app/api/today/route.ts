import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyOffers, dailyPicks, type Candidate } from "@/db/schema";
import { apiError, currentUserId, unauthorized } from "@/lib/api";
import { makeCandidates } from "@/lib/items";
import { SERVICE_START, servicePeriod, todayKst } from "@/lib/kst";
import { formatDate } from "@/lib/labels";
import { findPick } from "@/lib/picks";

const publicCandidates = (candidates: Candidate[]) =>
  candidates.map(({ itemType, color, variant, pos }, index) => ({ index, itemType, color, variant, pos }));

// 오늘의 후보 3개. 그날 처음 요청할 때 만들어 저장하고, 이후에는 저장된 것을 돌려준다.
// 이미 골랐다면 고른 결과를 돌려준다.
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return unauthorized();

  const today = todayKst();
  const period = servicePeriod(today);
  if (period !== "open") {
    return apiError(403, `period_${period}`, period === "before" ? `${formatDate(SERVICE_START)}에 시작해요.` : "올해 운세는 끝났어요.");
  }

  const pick = await findPick(userId, today);
  if (pick) return NextResponse.json({ today, picked: true, pick });

  const byDay = and(eq(dailyOffers.userId, userId), eq(dailyOffers.date, today));
  let [offer] = await db.select({ candidates: dailyOffers.candidates }).from(dailyOffers).where(byDay);

  if (!offer) {
    const placed = await db
      .select({ itemType: dailyPicks.itemType, posX: dailyPicks.posX, posY: dailyPicks.posY, posZ: dailyPicks.posZ })
      .from(dailyPicks)
      .where(eq(dailyPicks.userId, userId));
    const candidates = makeCandidates(placed.map((p) => ({ itemType: p.itemType, pos: [p.posX, p.posY, p.posZ] })));
    if (!candidates) return apiError(409, "tree_full", "트리가 이미 가득 찼어요.");

    // 동시에 두 요청이 와도 먼저 저장된 하나만 남는다
    await db.insert(dailyOffers).values({ userId, date: today, candidates }).onConflictDoNothing();
    [offer] = await db.select({ candidates: dailyOffers.candidates }).from(dailyOffers).where(byDay);
  }

  return NextResponse.json({ today, picked: false, candidates: publicCandidates(offer.candidates) });
}
