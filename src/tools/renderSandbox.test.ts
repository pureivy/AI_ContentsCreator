import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NETBOX_REAL_CHROME, NETBOX_SCRIPT, renderBrowserExecutable } from './renderSandbox';
import { tamperTracked } from '../orchestrator/longformScenes';

describe('renderBrowserExecutable — 렌더 브라우저 네트워크 상자', () => {
  const all = () => true;
  it('macOS·sandbox-exec·상자 스크립트·진짜 브라우저가 다 있으면 상자 스크립트', () => {
    expect(renderBrowserExecutable({ enabled: true, platform: 'darwin', exists: all })).toBe(NETBOX_SCRIPT);
  });
  it('끄거나 갖춰지지 않으면 null(기본 브라우저) — 경고는 한 번', () => {
    const warns: string[] = [];
    expect(renderBrowserExecutable({ enabled: false, platform: 'darwin', exists: all })).toBeNull();
    expect(renderBrowserExecutable({ enabled: true, platform: 'linux', exists: all, warn: (m) => warns.push(m) })).toBeNull();
    expect(renderBrowserExecutable({ enabled: true, platform: 'darwin', exists: (p) => p !== NETBOX_REAL_CHROME, warn: (m) => warns.push(m) })).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('macOS 아님');
  });
  it('상자 파일 — 나가는 연결은 localhost 3000~3100·유닉스 소켓만, 실행 권한·이름 풀이 차단', () => {
    const sb = fs.readFileSync(NETBOX_SCRIPT.replace(/\.sh$/, '.sb'), 'utf8');
    expect(sb).toContain('(deny network-outbound)');
    expect(sb).toContain('(remote ip "localhost:3000")');
    expect(sb).toContain('(remote ip "localhost:3100")');
    expect(sb).not.toContain('localhost:8787');
    expect(sb).not.toMatch(/localhost:\*/);
    expect(fs.statSync(NETBOX_SCRIPT).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(NETBOX_SCRIPT, 'utf8')).toContain('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost');
  });
  it('상자 파일은 변조 감시 대상', () => {
    expect(tamperTracked('/r/scripts/render', 'chrome_netbox.sh')).toBe(true);
    expect(tamperTracked('/r/scripts/render', 'chrome_netbox.sb')).toBe(true);
    expect(tamperTracked('/r/scripts/render', 'notes.md')).toBe(false);
  });
});
