import { and, eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Kakao from "next-auth/providers/kakao";
import { db } from "@/db";
import { users } from "@/db/schema";

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: number; // users.id
    kakaoId?: string; // 카카오 회원번호
  }
}

// 로그인하지 않은 세션. user를 아예 빼면 서버 쪽 auth()가 그 자리에 토큰 전체를 user로 채우므로 undefined로 덮어쓴다
const loggedOut = (expires: string) => ({ expires, user: undefined });

// 세션은 httpOnly 쿠키에 담긴 JWT로 관리하고, token.uid에 우리 DB의 users.id를 담는다.
// 주의: DB 어댑터 없이 쓰면 token.sub는 로그인할 때마다 새로 만든 UUID라서 사용자를 구분할 수 없다.
// 카카오 회원번호는 로그인 순간의 account.providerAccountId로만 받을 수 있다.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Kakao],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // 로그인 직후 한 번만 users에 저장한다. token.name에는 카카오 닉네임이 들어 있다
      if (account?.provider === "kakao") {
        const nickname = token.name ?? "산타";
        const [user] = await db
          .insert(users)
          .values({ kakaoId: account.providerAccountId, nickname })
          .onConflictDoUpdate({ target: users.kakaoId, set: { nickname } })
          .returning({ id: users.id });
        token.uid = user.id;
        token.kakaoId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      // 이 방식 이전에 만들어진 세션(kakaoId 없음)은 로그인하지 않은 것으로 본다
      if (!token.kakaoId || token.uid === undefined) return loggedOut(session.expires);
      // DB에서 지워진 사용자(탈퇴, 정리)의 쿠키가 남아 있어도 로그인하지 않은 것으로 본다.
      // 그대로 두면 없는 users.id로 기록을 쓰려다 서버 오류가 난다.
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, token.uid), eq(users.kakaoId, token.kakaoId)));
      if (!user) return loggedOut(session.expires);
      session.user.id = String(token.uid);
      return session;
    },
  },
});
