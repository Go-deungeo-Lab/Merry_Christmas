import { NextResponse } from "next/server";
import { currentUserId, unauthorized } from "@/lib/api";
import { servicePeriod, todayKst } from "@/lib/kst";
import { listPicks } from "@/lib/picks";

// 내 트리에 놓인 아이템 전부(각자의 운세 포함)와 오늘 골랐는지 여부
export async function GET() {
  const userId = await currentUserId();
  if (userId === null) return unauthorized();

  const today = todayKst();
  const items = await listPicks(userId);
  return NextResponse.json({
    today,
    period: servicePeriod(today),
    pickedToday: items.some((item) => item.date === today),
    items,
  });
}
