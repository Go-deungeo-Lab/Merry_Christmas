import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyPicks, fortunes } from "@/db/schema";

const pickColumns = {
  date: dailyPicks.date,
  itemType: dailyPicks.itemType,
  color: dailyPicks.color,
  variant: dailyPicks.variant,
  posX: dailyPicks.posX,
  posY: dailyPicks.posY,
  posZ: dailyPicks.posZ,
  fortune: {
    title: fortunes.title,
    message: fortunes.message,
    advice: fortunes.advice,
    luckyColor: fortunes.luckyColor,
    luckyItem: fortunes.luckyItem,
    luckyNumber: fortunes.luckyNumber,
  },
};

type PickRow = Awaited<ReturnType<typeof selectPicks>>[number];

function selectPicks(userId: number, date?: string) {
  return db
    .select(pickColumns)
    .from(dailyPicks)
    .innerJoin(fortunes, eq(dailyPicks.fortuneId, fortunes.id))
    .where(date ? and(eq(dailyPicks.userId, userId), eq(dailyPicks.date, date)) : eq(dailyPicks.userId, userId))
    .orderBy(asc(dailyPicks.date));
}

export function toPickJson({ posX, posY, posZ, ...rest }: PickRow) {
  return { ...rest, pos: [posX, posY, posZ] as [number, number, number] };
}

export async function listPicks(userId: number) {
  return (await selectPicks(userId)).map(toPickJson);
}

export async function findPick(userId: number, date: string) {
  const [row] = await selectPicks(userId, date);
  return row ? toPickJson(row) : null;
}

// 그 사람이 아직 보지 않은 운세 중 하나. 다 봤으면 전체에서 고른다. 운세가 하나도 없으면 null
export async function drawFortuneId(userId: number): Promise<number | null> {
  const seen = db.select({ id: dailyPicks.fortuneId }).from(dailyPicks).where(eq(dailyPicks.userId, userId));
  const [fresh] = await db
    .select({ id: fortunes.id })
    .from(fortunes)
    .where(notInArray(fortunes.id, seen))
    .orderBy(sql`random()`)
    .limit(1);
  if (fresh) return fresh.id;
  const [any] = await db.select({ id: fortunes.id }).from(fortunes).orderBy(sql`random()`).limit(1);
  return any?.id ?? null;
}
