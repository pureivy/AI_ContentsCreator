/**
 * 알림 전송 — 자율 사이클 완료·일일 브리핑을 사용자에게 push(Connect AI 텔레그램 비서·브리핑 대응).
 * 채널: 웹훅(Slack/Discord/커스텀) + 텔레그램. 자격은 시크릿(getSecret) 또는 env. 미설정이면 no-op(회귀 0).
 * 실패는 무해(전송 실패가 런/브리핑을 막지 않음). 웹훅 URL 은 운영자 본인 설정이라 SSRF 표면 아님(http(s)만 허용).
 */
import { getSecret } from '../secrets/store';

export interface NotifyMessage { title: string; body: string; }

/** 시크릿 우선, 없으면 env. */
function cred(key: string): string {
  return (getSecret(key) || process.env[key] || '').trim();
}

/** 설정된 모든 채널로 전송. 반환: 성공 전송 채널 수(0=미설정 또는 전부 실패). */
export async function notify(msg: NotifyMessage): Promise<number> {
  const tasks: Array<Promise<boolean>> = [];
  const webhook = cred('NOTIFY_WEBHOOK_URL');
  if (webhook) tasks.push(sendWebhook(webhook, msg));
  const tgToken = cred('TELEGRAM_BOT_TOKEN');
  const tgChat = cred('TELEGRAM_CHAT_ID');
  if (tgToken && tgChat) tasks.push(sendTelegram(tgToken, tgChat, msg));
  if (!tasks.length) return 0;
  const results = await Promise.all(tasks);
  return results.filter(Boolean).length;
}

/** 알림 채널이 하나라도 설정돼 있는지(전송 시도 전 가드용). */
export function notifyConfigured(): boolean {
  return !!cred('NOTIFY_WEBHOOK_URL') || !!(cred('TELEGRAM_BOT_TOKEN') && cred('TELEGRAM_CHAT_ID'));
}

async function sendWebhook(url: string, msg: NotifyMessage): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false; // http(s) 만
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Slack/Discord 호환(text) + 구조화 필드 동봉.
      body: JSON.stringify({ text: `*${msg.title}*\n${msg.body}`, title: msg.title, body: msg.body }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function sendTelegram(token: string, chatId: string, msg: NotifyMessage): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `${msg.title}\n${msg.body}`.slice(0, 4000) }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
