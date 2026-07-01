// Avatar — 역할 id를 스프라이트 캐릭터(officeSprites.spriteFor)로 해석해 그 캐릭터의 _face 헤드샷
// (/sprites/<char>_face.png)을 보여준다. 오피스 뷰 스프라이트와 **같은 캐릭터 세트로 통일** — 타임라인·
// 직원목록·티커의 얼굴이 사무실 아바타와 동일 인물로 보인다. 매칭 없으면 역할 이모지로 폴백.
//
// `head` 모드는 둥근 클립 안에 얼굴을 넣는다. _face 는 이미 헤드샷이라 예전 bobblehead 처럼 확대 크롭하지
// 않고(.avatar-face → transform:none) object-fit:cover 로 원에 채운다.
import { useState } from "react";
import { spriteFor } from "./officeSprites";

// 스프라이트/얼굴 파일 갱신 시 브라우저 캐시 무효화용.
const AVATAR_VERSION = 10;

export default function Avatar({
  id,
  glyph,
  size = 26,
  className = "",
  head = false,
}: {
  id?: string | null;
  glyph: string;
  size?: number;
  className?: string;
  head?: boolean;
}) {
  const [err, setErr] = useState(false);
  const char = spriteFor(id ?? "");

  if (err || !char) {
    // 스프라이트 캐릭터 매칭 없음(또는 이미지 로드 실패) → 역할 이모지 폴백.
    if (head) {
      return (
        <span
          className={`avatar-head avatar-head-fallback ${className}`}
          style={{ width: size, height: size, fontSize: Math.round(size * 0.6), lineHeight: 1 }}
        >
          {glyph}
        </span>
      );
    }
    return (
      <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
        {glyph}
      </span>
    );
  }

  const src = `/sprites/${char}_face.png?v=${AVATAR_VERSION}`;
  if (head) {
    return (
      <span className={`avatar-head ${className}`} style={{ width: size, height: size }}>
        <img className="avatar-img avatar-face" src={src} alt="" draggable={false} onError={() => setErr(true)} />
      </span>
    );
  }
  return (
    <img
      className={`avatar-img avatar-face ${className}`}
      src={src}
      alt=""
      draggable={false}
      onError={() => setErr(true)}
    />
  );
}
