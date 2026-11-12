import NextAuth from "next-auth";
import Kakao from "next-auth/providers/kakao";
import { db } from "@/db";
import { users } from "@/db/schema";

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: number; // users.id
  }
}

// 세션은 httpOnly 쿠키에 담긴 JWT로 관리한다.
// token.sub에는 카카오 회원번호가, token.uid에는 우리 DB의 users.id가 들어간다.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Kakao],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token }) {
      // 로그인 직후(또는 uid가 없던 예전 세션) 한 번만 users에 저장한다
      if (token.uid === undefined && token.sub) {
        const nickname = token.name ?? "산타";
        const [user] = await db
          .insert(users)
          .values({ kakaoId: token.sub, nickname })
          .onConflictDoUpdate({ target: users.kakaoId, set: { nickname } })
          .returning({ id: users.id });
        token.uid = user.id;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.uid);
      return session;
    },
  },
});
