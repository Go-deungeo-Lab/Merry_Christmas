"use client";

import { useEffect, useState } from "react";

// 서비스 기준 시간대인 KST로 고정 (보는 사람의 시간대와 무관하게 같은 순간)
const TARGET = new Date("2027-01-01T00:00:00+09:00").getTime();

const pad = (n: number) => String(n).padStart(2, "0");

export default function Countdown({ className }: { className?: string }) {
  // 서버 렌더링 시각과 브라우저 시각이 달라 hydration이 어긋나지 않도록 마운트 후에 계산
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(TARGET - Date.now(), 0));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (remaining === null) {
    return <div className={className} aria-hidden="true" />;
  }

  if (remaining === 0) {
    return (
      <div className={className}>
        <p data-role="time">Happy New Year 2027</p>
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className={className} role="timer">
      <p data-role="label">2027년 1월 1일까지</p>
      <p data-role="time">
        {days}일 {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </p>
    </div>
  );
}
