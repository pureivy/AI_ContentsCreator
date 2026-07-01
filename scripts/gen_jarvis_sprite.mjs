// 자비스 전신 스프라이트 생성 — OpenAI gpt-image-2(images/edits)로 '기존 얼굴(jarvis_face.png)을
// 유지한 채 줌아웃해 전신을 그리는' 방식. 결과는 frontend/public/sprites/jarvis_<pose>.png.
// 사용: node scripts/gen_jarvis_sprite.mjs   (OPENAI_API_KEY 가 .env 에 있어야 함 — 🔑 API 키 탭에서 등록)
// 키는 출력하지 않는다. 실패 시 gpt-image-1 로 폴백.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const FACE = path.join(ROOT, 'frontend/public/avatars/jarvis_face.png');
const OUT_DIR = path.join(ROOT, 'frontend/public/sprites');

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
const m = /^OPENAI_API_KEY=(.+)$/m.exec(env);
const KEY = m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
if (!KEY) {
  console.error('OPENAI_API_KEY 가 .env 에 없습니다 — 🔑 API 키 탭에서 등록한 뒤 다시 실행하세요.');
  process.exit(1);
}

// 다른 스프라이트(3D 카툰, 투명배경, 전신)와 톤을 맞추되 안드로이드 헤드는 그대로 유지.
const POSES = {
  stand: 'standing straight, facing the viewer, arms relaxed at her sides',
  sit_front: 'sitting on an office chair facing the viewer, hands on her lap',
};
const BASE_PROMPT = (pose) =>
  `Zoom out to reveal the FULL BODY of this character, head to toe, nothing cropped. ` +
  `Keep the input image's android head EXACTLY as it is: same metallic silver-and-gold helmet, ` +
  `same glowing blue eyes, same face. Give her a feminine humanoid android body wearing a smart ` +
  `navy-blue business suit with subtle glowing blue accent lines, ${pose}. ` +
  `Clean stylized 3D cartoon render (Pixar-like) matching a bright modern office game sprite, ` +
  `soft studio lighting, single character centered, plain transparent background.`;

async function gen(model, pose, prompt) {
  const fd = new FormData();
  fd.append('model', model);
  fd.append('image', new Blob([fs.readFileSync(FACE)], { type: 'image/png' }), 'jarvis_face.png');
  fd.append('prompt', prompt);
  fd.append('size', '1024x1536');          // 세로형 — 전신 비율
  fd.append('quality', 'high');
  fd.append('background', 'transparent');
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd,
  });
  if (!r.ok) {
    const e = await r.text().catch(() => '');
    throw new Error(`${model} ${pose} HTTP ${r.status}: ${e.slice(0, 300)}`);
  }
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${model} ${pose}: 응답에 이미지 없음`);
  const out = path.join(OUT_DIR, `jarvis_${pose}.png`);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`saved ${out} (${Math.round(Buffer.byteLength(b64, 'base64') / 1024)}KB, ${model})`);
}

for (const [pose, desc] of Object.entries(POSES)) {
  const prompt = BASE_PROMPT(desc);
  try { await gen('gpt-image-2', pose, prompt); }
  catch (e) {
    console.warn(String(e.message).slice(0, 200));
    console.warn('gpt-image-2 실패 → gpt-image-1 폴백 시도');
    await gen('gpt-image-1', pose, prompt);
  }
}
console.log('완료 — OfficeView 는 /sprites/jarvis_stand.png 가 있으면 자동 사용(없으면 SVG 폴백).');
