import AsciiTree from "@/components/AsciiTree";
import Countdown from "@/components/Countdown";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <AsciiTree className={styles.tree} />
      <Countdown className={styles.countdown} />
    </main>
  );
}
