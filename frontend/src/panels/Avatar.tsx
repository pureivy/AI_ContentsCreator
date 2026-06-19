// Avatar — shows an employee's generated character image (/avatars/<id>.png),
// falling back to the role emoji when the image is missing or fails to load.
// Purely additive: with no images, every avatar renders exactly as before.
//
// `head` mode crops the (square, bobble-head) portrait down to just the head:
// the source can't be cropped with object-fit alone (square into square = no
// crop), so we zoom the <img> with a transform inside a round clip. The
// onError→glyph fallback still works because it's the same <img>.
import { useState } from "react";

// Bump when avatars are regenerated so browsers fetch the new image (same filename).
const AVATAR_VERSION = 9;

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

  if (err || !id) {
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

  const src = `/avatars/${id}.png?v=${AVATAR_VERSION}`;
  if (head) {
    return (
      <span className={`avatar-head ${className}`} style={{ width: size, height: size }}>
        <img className="avatar-img" src={src} alt="" draggable={false} onError={() => setErr(true)} />
      </span>
    );
  }
  return (
    <img
      className={`avatar-img ${className}`}
      src={src}
      alt=""
      draggable={false}
      onError={() => setErr(true)}
    />
  );
}
