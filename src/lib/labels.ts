import type { ItemType } from "@/db/schema";

export const ITEM_LABEL: Record<ItemType, string> = {
  ornament: "오너먼트",
  light: "전구",
  gift: "선물 상자",
  teddy: "곰인형",
  carpet: "카펫",
  snow: "눈 내리기",
  star: "꼭대기 별",
};

export const COLOR_LABEL: Record<string, string> = {
  red: "빨강",
  gold: "금색",
  blue: "파랑",
  silver: "은색",
  green: "초록",
  warm: "따뜻한 빛",
  white: "하얀 빛",
  multi: "알록달록",
  brown: "갈색",
  cream: "크림색",
};

export const VARIANT_LABEL: Record<string, string> = {
  plain: "",
  stripe: "줄무늬",
  glitter: "반짝이",
  steady: "은은하게",
  twinkle: "반짝반짝",
  small: "작은",
  medium: "",
  large: "큰",
  red_bow: "빨간 리본",
  green_bow: "초록 리본",
  default: "",
};

// 색·모양 설명. 눈 내리기는 색이 하나뿐이라 붙이지 않는다
export function itemDetail(item: { itemType: ItemType; color: string; variant: string }) {
  if (item.itemType === "snow") return [];
  return [COLOR_LABEL[item.color], VARIANT_LABEL[item.variant]].filter(Boolean);
}

export function describeItem(item: { itemType: ItemType; color: string; variant: string }) {
  return [...itemDetail(item), ITEM_LABEL[item.itemType]].join(" ");
}

// "2026-11-20" → "11월 20일"
export function formatDate(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일`;
}
