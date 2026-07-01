// Task 0 — Claude 구독 인증 + 과금/레이트 실증 스파이크
//
// 목적(기획서 5a Task 0):
//   (a) new Anthropic()(OAuth 프로필)로 무감시 반복 호출이 되는가 / 토큰 자동 갱신되는가
//   (b) 과금이 정액(구독)인가 메터드(토큰당)인가  ← 레이트 헤더 티어 + 결제 콘솔로 판정
//   (c) 연속 호출이 부딪는 구독 레이트리밋 벽은 어디인가
//
// 선행: `ant auth login`(구독 OAuth)  또는  export ANTHROPIC_API_KEY=...(메터드 폴백)
// 실행: pnpm exec tsx scripts/spike_claude_auth.ts
//   반복 수 조정:      SPIKE_N=20 pnpm exec tsx scripts/spike_claude_auth.ts
//   장시간 소크(수 시간): SPIKE_N=200 SPIKE_DELAY_MS=60000 pnpm exec tsx scripts/spike_claude_auth.ts

import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.SPIKE_MODEL ?? 'claude-haiku-4-5'
const N = Number(process.env.SPIKE_N ?? 5)
const DELAY_MS = Number(process.env.SPIKE_DELAY_MS ?? 0)

function authHint(): string {
  if (process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY (메터드 API 키)'
  if (process.env.ANTHROPIC_AUTH_TOKEN) return 'ANTHROPIC_AUTH_TOKEN'
  return 'OAuth 프로필(ant auth login) 또는 기본 프로필 — 구독 인증 가능성'
}

const RATE_KEYS = [
  'anthropic-ratelimit-requests-limit',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-tokens-limit',
  'anthropic-ratelimit-tokens-remaining',
  'anthropic-ratelimit-input-tokens-remaining',
  'anthropic-ratelimit-output-tokens-remaining',
  'retry-after',
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('=== Task 0: Claude 인증·레이트 스파이크 ===')
  console.log('추정 인증 소스:', authHint())
  console.log(`모델=${MODEL}  반복=${N}  간격=${DELAY_MS}ms\n`)

  const client = new Anthropic() // apiKey 미지정 → SDK 자격증명 체인(env/토큰/OAuth 프로필)

  let ok = 0
  for (let i = 1; i <= N; i++) {
    const t0 = Date.now()
    try {
      const { data, response } = await client.messages
        .create({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] })
        .withResponse()
      const ms = Date.now() - t0
      ok++
      const rl: Record<string, string> = {}
      for (const k of RATE_KEYS) {
        const v = response.headers.get(k)
        if (v) rl[k] = v
      }
      console.log(
        `#${i} ok ${ms}ms model=${data.model} usage=in:${data.usage.input_tokens}/out:${data.usage.output_tokens}`,
      )
      console.log('   rate:', JSON.stringify(rl))
    } catch (e: any) {
      console.log(`#${i} ERROR status=${e?.status} type=${e?.error?.type ?? e?.name} msg=${e?.message}`)
      const h = e?.headers
      if (h) {
        const rl: Record<string, string> = {}
        for (const k of RATE_KEYS) {
          const v = typeof h.get === 'function' ? h.get(k) : h[k]
          if (v) rl[k] = v
        }
        if (Object.keys(rl).length) console.log('   rate:', JSON.stringify(rl))
      }
    }
    if (DELAY_MS && i < N) await sleep(DELAY_MS)
  }

  console.log(`\n결과: ${ok}/${N} 성공`)
  console.log('판정 가이드:')
  console.log('  - 성공 = new Anthropic()가 프로필/키로 인증됨 (질문 a).')
  console.log('  - rate 헤더의 limit 값이 구독 티어(Pro rpm≈60 / Max rpm≈200)면 구독 인증 신호 (질문 b/c).')
  console.log('  - 정액 vs 메터드 최종 확인: platform.claude.com 결제 콘솔에 이 사용량이 과금되는지 확인.')
  console.log('  - 무감시 장시간: SPIKE_N 크게 + SPIKE_DELAY_MS로 수 시간 반복 → 토큰 자동갱신·5시간 창 벽 관찰.')
}

main().catch((e) => {
  console.error('치명적 오류:', e)
  process.exit(1)
})
