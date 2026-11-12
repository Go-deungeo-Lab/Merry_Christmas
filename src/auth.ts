import NextAuth from "next-auth";
import Kakao from "next-auth/providers/kakao";

// 세션은 DB 없이 httpOnly 쿠키에 담긴 JWT로 관리한다.
// token.sub에는 카카오 회원번호가, token.name에는 닉네임이 들어간다.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Kakao],
  session: { strategy: "jwt" },
  callbacks: {
    session({ session, token }) {
      session.user.id = token.sub!;
      return session;
    },
  },
});
