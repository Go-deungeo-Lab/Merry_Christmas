"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./TreeScene.module.css";

// 네이티브 <dialog>: 포커스 가두기와 Esc 닫기를 브라우저가 처리한다
export default function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // 바깥(배경)을 누르면 닫는다
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
          ×
        </button>
        {children}
      </div>
    </dialog>
  );
}
