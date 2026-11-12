import { auth, signIn, signOut } from "@/auth";

export default async function AuthButton({ className }: { className?: string }) {
  const session = await auth();

  if (!session?.user) {
    return (
      <form
        className={className}
        action={async () => {
          "use server";
          await signIn("kakao");
        }}
      >
        <button type="submit">카카오로 시작하기</button>
      </form>
    );
  }

  return (
    <form
      className={className}
      action={async () => {
        "use server";
        await signOut();
      }}
    >
      <span>{session.user.name}님</span>
      <button type="submit">로그아웃</button>
    </form>
  );
}
