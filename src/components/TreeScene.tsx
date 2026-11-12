"use client";

import { useEffect, useState } from "react";
import AsciiTree, { type TreeItem } from "@/components/AsciiTree";
import { DEMO_ITEMS } from "@/lib/demo-items";

type TreeResponse = {
  today: string;
  period: "before" | "open" | "after";
  pickedToday: boolean;
  items: TreeItem[];
};

const NO_ITEMS: TreeItem[] = [];

// 로그인 전에는 완성된 데모 트리, 로그인 뒤에는 내 트리
export default function TreeScene({ loggedIn, className }: { loggedIn: boolean; className?: string }) {
  const [tree, setTree] = useState<TreeResponse | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    fetch("/api/tree")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TreeResponse | null) => {
        if (alive) setTree(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loggedIn]);

  const items = loggedIn ? (tree?.items ?? NO_ITEMS) : DEMO_ITEMS;
  const showTodayLight = loggedIn && tree?.period === "open" && !tree.pickedToday;

  return (
    <AsciiTree
      className={className}
      items={items}
      showTodayLight={showTodayLight}
      onTodayLightClick={() => {
        // 7단계: 후보 3개 열기
      }}
      onItemClick={() => {
        // 7단계: 그날의 운세 다시 보기
      }}
    />
  );
}
