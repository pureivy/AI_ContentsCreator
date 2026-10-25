#!/bin/bash
# 렌더 브라우저 네트워크 상자(2026-10-25) — Remotion 이 browserExecutable 로 이 파일을 띄운다(src/tools/renderSandbox.ts).
# 진짜 chrome-headless-shell 을 macOS 샌드박스(chrome_netbox.sb)에 넣고, 이름 풀이도 localhost 말고는 막는다(겹 방어).
here="$(cd "$(dirname "$0")" && pwd)"
real="$here/../../node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell"
[ -x "$real" ] || { echo "chrome_netbox: 진짜 브라우저 없음 — $real" >&2; exit 127; }
exec /usr/bin/sandbox-exec -f "$here/chrome_netbox.sb" "$real" "$@" "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost" --force-webrtc-ip-handling-policy=disable_non_proxied_udp
