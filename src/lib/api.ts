import { NextResponse } from "next/server";
import { auth } from "@/auth";

export function apiError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

// 로그인한 사용자의 users.id. 로그인하지 않았으면 null
export async function currentUserId(): Promise<number | null> {
  const session = await auth();
  const id = Number(session?.user?.id);
  return Number.isInteger(id) ? id : null;
}

export const unauthorized = () => apiError(401, "unauthorized", "로그인이 필요해요.");
