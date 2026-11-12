// src/db/seed/fortunes.json의 운세 중 DB에 아직 없는 제목만 넣는다. 여러 번 실행해도 안전하다.
// 실행: npm run db:seed
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const fortunes = JSON.parse(readFileSync(new URL("../src/db/seed/fortunes.json", import.meta.url), "utf8"));
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const existing = new Set((await sql.query("select title from fortunes")).map((row) => row.title));
const fresh = fortunes.filter((f) => !existing.has(f.title));
for (const f of fresh) {
  await sql.query(
    "insert into fortunes (title, message, advice, lucky_color, lucky_item, lucky_number) values ($1, $2, $3, $4, $5, $6)",
    [f.title, f.message, f.advice, f.luckyColor, f.luckyItem, f.luckyNumber],
  );
}
console.log(`운세 ${fresh.length}개 추가 (파일 ${fortunes.length}개, 이미 있던 것 ${fortunes.length - fresh.length}개)`);
