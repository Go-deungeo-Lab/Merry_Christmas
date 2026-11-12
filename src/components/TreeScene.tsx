"use client";

import { useCallback, useEffect, useState } from "react";
import AsciiTree, { type TreeItem } from "@/components/AsciiTree";
import Modal from "@/components/Modal";
import { DEMO_ITEMS } from "@/lib/demo-items";
import ItemPreview from "@/components/ItemPreview";
import { ITEM_LABEL, describeItem, formatDate, itemDetail } from "@/lib/labels";
import styles from "./TreeScene.module.css";

type Fortune = {
  title: string;
  message: string;
  advice: string;
  luckyColor: string;
  luckyItem: string;
  luckyNumber: number;
};
type Pick = TreeItem & { date: string; fortune: Fortune };
type Candidate = TreeItem & { index: number };

type TreeResponse = {
  today: string;
  period: "before" | "open" | "after";
  pickedToday: boolean;
  items: Pick[];
};

type View =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "offer"; candidates: Candidate[]; picking: number | null; error?: string }
  | { kind: "fortune"; pick: Pick; fresh: boolean }
  | { kind: "history" }
  | { kind: "error"; message: string };

const NO_ITEMS: TreeItem[] = [];
const NETWORK_ERROR = "연결이 불안정해요. 잠시 뒤에 다시 시도해 주세요.";

async function request<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    if (res.status === 401) return { ok: false, message: "로그인이 풀렸어요. 다시 로그인해 주세요." };
    return { ok: false, message: body?.message ?? NETWORK_ERROR };
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }
}

// 로그인 전에는 완성된 데모 트리, 로그인 뒤에는 내 트리
export default function TreeScene({ loggedIn, className }: { loggedIn: boolean; className?: string }) {
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [view, setView] = useState<View>({ kind: "closed" });

  const loadTree = useCallback(async () => {
    const result = await request<TreeResponse>("/api/tree");
    if (result.ok) setTree(result.data);
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    loadTree();
    // 자정을 넘겨 탭으로 돌아오면 새 불빛이 켜지도록 다시 가져온다
    const onVisible = () => {
      if (document.visibilityState === "visible") loadTree();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loggedIn, loadTree]);

  const close = () => setView({ kind: "closed" });

  const openToday = async () => {
    setView({ kind: "loading" });
    const result = await request<{ picked: true; pick: Pick } | { picked: false; candidates: Candidate[] }>("/api/today");
    if (!result.ok) return setView({ kind: "error", message: result.message });
    if (result.data.picked) return setView({ kind: "fortune", pick: result.data.pick, fresh: false });
    setView({ kind: "offer", candidates: result.data.candidates, picking: null });
  };

  const choose = async (index: number) => {
    if (view.kind !== "offer" || view.picking !== null) return;
    setView({ ...view, picking: index, error: undefined });
    const result = await request<{ pick: Pick }>("/api/today/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    });
    if (!result.ok) return setView({ ...view, picking: null, error: result.message });
    const { pick } = result.data;
    setTree((prev) =>
      prev && !prev.items.some((item) => item.date === pick.date)
        ? { ...prev, pickedToday: true, items: [...prev.items, pick] }
        : prev,
    );
    setView({ kind: "fortune", pick, fresh: true });
  };

  const items = loggedIn ? (tree?.items ?? NO_ITEMS) : DEMO_ITEMS;
  const canPick = loggedIn && tree?.period === "open" && !tree.pickedToday;

  return (
    <>
      <AsciiTree
        className={className}
        items={items}
        showTodayLight={canPick}
        onTodayLightClick={openToday}
        onItemClick={(index) => {
          const pick = tree?.items[index];
          if (loggedIn && pick) setView({ kind: "fortune", pick, fresh: false });
        }}
      />

      <Hint loggedIn={loggedIn} tree={tree} onOpenToday={openToday} />

      {loggedIn && tree && tree.items.length > 0 && (
        <button type="button" className={styles.historyButton} onClick={() => setView({ kind: "history" })}>
          운세 기록 {tree.items.length}
        </button>
      )}

      {view.kind === "loading" && (
        <Modal label="오늘의 아이템" onClose={close}>
          <p className={styles.muted}>불빛을 여는 중…</p>
        </Modal>
      )}

      {view.kind === "error" && (
        <Modal label="알림" onClose={close}>
          <p className={styles.message}>{view.message}</p>
          <button type="button" className={styles.primary} onClick={close}>
            확인
          </button>
        </Modal>
      )}

      {view.kind === "offer" && (
        <Modal label="오늘의 아이템 고르기" onClose={close}>
          <p className={styles.eyebrow}>{tree ? formatDate(tree.today) : "오늘"}의 불빛</p>
          <h2 className={styles.heading}>하나를 골라 트리에 걸어 주세요</h2>
          <p className={styles.muted}>고른 아이템과 함께 오늘의 운세가 열려요. 하루에 한 번만 고를 수 있어요.</p>
          <div className={styles.candidates}>
            {view.candidates.map((candidate) => (
              <button
                key={candidate.index}
                type="button"
                className={styles.candidate}
                disabled={view.picking !== null}
                aria-busy={view.picking === candidate.index}
                onClick={() => choose(candidate.index)}
              >
                <ItemPreview item={candidate} className={styles.preview} />
                <span className={styles.candidateName}>{ITEM_LABEL[candidate.itemType]}</span>
                <span className={styles.candidateDetail}>
                  {itemDetail(candidate).join(" · ")}
                </span>
              </button>
            ))}
          </div>
          {view.picking !== null && <p className={styles.muted}>운세를 펼치는 중…</p>}
          {view.error && <p className={styles.error}>{view.error}</p>}
        </Modal>
      )}

      {view.kind === "fortune" && (
        <Modal label="운세" onClose={close}>
          <FortuneCard pick={view.pick} fresh={view.fresh} />
          <button type="button" className={styles.primary} onClick={close}>
            {view.fresh ? "트리에서 보기" : "닫기"}
          </button>
        </Modal>
      )}

      {view.kind === "history" && tree && (
        <Modal label="운세 기록" onClose={close}>
          <h2 className={styles.heading}>운세 기록</h2>
          <ul className={styles.history}>
            {[...tree.items].reverse().map((pick) => (
              <li key={pick.date}>
                <button type="button" onClick={() => setView({ kind: "fortune", pick, fresh: false })}>
                  <span className={styles.historyDate}>{formatDate(pick.date)}</span>
                  <span className={styles.historyTitle}>{pick.fortune.title}</span>
                  <span className={styles.historyItem}>{ITEM_LABEL[pick.itemType]}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

function FortuneCard({ pick, fresh }: { pick: Pick; fresh: boolean }) {
  const { fortune } = pick;
  return (
    <article className={fresh ? `${styles.fortune} ${styles.reveal}` : styles.fortune}>
      <p className={styles.eyebrow}>
        {formatDate(pick.date)} · {describeItem(pick)}
      </p>
      <h2 className={styles.fortuneTitle}>{fortune.title}</h2>
      <p className={styles.message}>{fortune.message}</p>
      <p className={styles.advice}>
        <span>오늘의 조언</span>
        {fortune.advice}
      </p>
      <dl className={styles.lucky}>
        <div>
          <dt>행운의 색</dt>
          <dd>{fortune.luckyColor}</dd>
        </div>
        <div>
          <dt>행운의 물건</dt>
          <dd>{fortune.luckyItem}</dd>
        </div>
        <div>
          <dt>행운의 숫자</dt>
          <dd>{fortune.luckyNumber}</dd>
        </div>
      </dl>
    </article>
  );
}

function Hint({ loggedIn, tree, onOpenToday }: { loggedIn: boolean; tree: TreeResponse | null; onOpenToday: () => void }) {
  if (!loggedIn) {
    return <p className={styles.hint}>매일 불빛을 눌러 아이템을 고르고, 오늘의 운세와 함께 나만의 트리를 꾸며 보세요</p>;
  }
  if (!tree) return null;
  if (tree.period === "before") return <p className={styles.hint}>11월 20일부터 매일 새 불빛이 켜져요</p>;
  if (tree.period === "after") return <p className={styles.hint}>올해의 트리가 완성됐어요. 아이템을 눌러 지난 운세를 다시 볼 수 있어요</p>;
  if (!tree.pickedToday) {
    return (
      <button type="button" className={`${styles.hint} ${styles.hintButton}`} onClick={onOpenToday}>
        반짝이는 불빛을 눌러 오늘의 아이템을 골라 보세요
      </button>
    );
  }
  return <p className={styles.hint}>오늘의 아이템을 걸었어요. 자정이 지나면 새 불빛이 켜져요</p>;
}
