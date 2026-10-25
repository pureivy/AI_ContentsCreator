/**
 * 렌더 브라우저 네트워크 상자(2026-10-25, RENDER_NET_SANDBOX — 기본 켬). 롱폼 장면·숏폼 모션그래픽 코드는 AI 세션이 쓰고,
 * 미리보기·사후 스틸·본편 렌더가 그 코드를 headless Chrome 에서 돌린다. 코드 검사(sceneSafety)만으로는 우회가 남아
 * 브라우저 자체를 macOS 샌드박스에 넣는다 — 나가는 연결은 Remotion 번들 서버(localhost 3000~3100)만(scripts/render/chrome_netbox.sb).
 * 진짜 브라우저(node_modules/.remotion)가 없거나 macOS 가 아니면 null — Remotion 기본 브라우저(상자 없음)로 돌고 한 번 경고한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export const NETBOX_SCRIPT = path.resolve('scripts', 'render', 'chrome_netbox.sh');
export const NETBOX_REAL_CHROME = path.resolve('node_modules', '.remotion', 'chrome-headless-shell', 'mac-arm64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
let warned = false;

/** Remotion browserExecutable 값 — 상자를 쓸 수 있으면 감싼 실행 파일, 아니면 null(기본 브라우저). */
export function renderBrowserExecutable(o: { enabled?: boolean; platform?: string; exists?: (p: string) => boolean; warn?: (m: string) => void } = {}): string | null {
  const enabled = o.enabled ?? CONFIG.renderNetSandbox;
  if (!enabled) return null;
  const exists = o.exists ?? ((p: string) => fs.existsSync(p));
  const missing = (o.platform ?? process.platform) !== 'darwin' ? 'macOS 아님' : !exists('/usr/bin/sandbox-exec') ? 'sandbox-exec 없음'
    : !exists(NETBOX_SCRIPT) ? '상자 스크립트 없음' : !exists(NETBOX_REAL_CHROME) ? 'Remotion 브라우저 미설치' : '';
  if (!missing) return NETBOX_SCRIPT;
  if (!warned) { warned = true; (o.warn ?? ((m: string) => console.warn(m)))(`[렌더 상자] ${missing} — 네트워크를 막지 않은 기본 브라우저로 렌더한다`); }
  return null;
}
