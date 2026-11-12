import {
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const itemType = pgEnum("item_type", [
  "ornament", // 오너먼트 (공)
  "light", // 전구
  "gift", // 선물 상자
  "teddy", // 곰인형
  "carpet", // 카펫
  "snow", // 눈 내리기
  "star", // 꼭대기 별
]);

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  kakaoId: text().notNull().unique(),
  nickname: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const fortunes = pgTable("fortunes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: text().notNull(),
  message: text().notNull(),
  advice: text().notNull(),
  luckyColor: text().notNull(),
  luckyItem: text().notNull(),
  luckyNumber: smallint().notNull(),
});

export type ItemType = (typeof itemType.enumValues)[number];

// 그날 처음 불빛을 눌렀을 때 서버가 정해 두는 후보 하나.
// 운세는 아이템과 무관하게 고르는 순간 정하므로 후보에는 없다.
export type Candidate = {
  itemType: ItemType;
  color: string;
  variant: string;
  pos: [number, number, number];
};

// (user_id, date)를 기본키로 두어 하루 한 번을 DB가 보장한다. 탈퇴하면 함께 지워진다.
export const dailyOffers = pgTable(
  "daily_offers",
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(), // 서버가 계산한 KST 날짜 (YYYY-MM-DD)
    candidates: jsonb().$type<Candidate[]>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

export const dailyPicks = pgTable(
  "daily_picks",
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    itemType: itemType().notNull(),
    color: text().notNull(),
    variant: text().notNull(),
    posX: real().notNull(),
    posY: real().notNull(),
    posZ: real().notNull(),
    fortuneId: integer()
      .notNull()
      .references(() => fortunes.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);
