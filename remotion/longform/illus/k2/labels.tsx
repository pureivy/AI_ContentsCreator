// 안전 라벨 — 글자 상자가 안전 영역(SAFE) 밖으로 나가지 않게 기준점을 민다. 모양은 diagramParts 의 Label 과 같다.
import React from 'react';
import { INK } from '../../InfoPanel';
import { Label } from '../../diagramParts';
import { SAFE, clampLabel, type SafeBox } from '../sceneUtil';

export const SafeLabel: React.FC<{ x: number; y: number; at?: number; children: string; color?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number; safe?: SafeBox }> = ({ x, y, at = 0, children, color = INK, size = 34, anchor = 'middle', weight = 800, safe = SAFE }) => {
  const c = clampLabel(x, y, children, size, anchor, safe);
  return <Label x={c.x} y={c.y} at={at} color={color} size={size} anchor={anchor} weight={weight}>{children}</Label>;
};
