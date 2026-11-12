// 트리 모양. 서버(아이템 위치 계산)와 클라이언트(렌더링)가 함께 쓴다.

export const FOLIAGE_BOTTOM = 0.3;
export const FOLIAGE_TOP = 1.1;
export const TREE_RADIUS = 0.44;
export const TIERS = 7;
export const TRUNK_RADIUS = 0.065;
export const TRUNK_HEIGHT = 0.36;
export const CARPET_RADIUS = 0.62;
export const FLOOR_RADIUS = 0.8;
export const STAR_Y = 1.16;

// 층마다 아랫부분이 튀어나오는 실루엣. t: 0 밑단 → 1 꼭대기
export function foliageRadius(t: number) {
  const fromTop = 1 - t;
  return TREE_RADIUS * fromTop * (0.8 + 0.2 * ((fromTop * TIERS) % 1));
}

export function foliageY(t: number, r: number) {
  // 가지 끝은 살짝 처지게
  return FOLIAGE_BOTTOM + t * (FOLIAGE_TOP - FOLIAGE_BOTTOM) - 0.04 * (r / TREE_RADIUS);
}
