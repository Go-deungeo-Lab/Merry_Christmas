import AsciiTree from "@/components/AsciiTree";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <AsciiTree className={styles.tree} />
    </main>
  );
}
