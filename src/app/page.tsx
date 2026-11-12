import { auth } from "@/auth";
import AuthButton from "@/components/AuthButton";
import Countdown from "@/components/Countdown";
import TreeScene from "@/components/TreeScene";
import styles from "./page.module.css";

export default async function Home() {
  const session = await auth();

  return (
    <main className={styles.main}>
      <TreeScene className={styles.tree} loggedIn={!!session?.user} />
      <Countdown className={styles.countdown} />
      <AuthButton className={styles.auth} />
    </main>
  );
}
