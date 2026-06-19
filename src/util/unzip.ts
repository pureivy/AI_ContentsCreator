/**
 * 최소 ZIP 리더(의존성 없음) — 중앙 디렉토리를 읽어 엔트리별 압축 해제.
 * HWPX/DOCX/XLSX/PPTX 텍스트 추출용(이들은 ZIP+XML). zlib.inflateRawSync 사용.
 */
import zlib from 'node:zlib';

export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (buf.length < 22) return out;
  // EOCD(0x06054b50) 를 끝에서 탐색(주석 최대 65535B 고려).
  let eocd = -1;
  const minI = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minI; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // 중앙 디렉토리 오프셋
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    if (lho + 30 <= buf.length) {
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtraLen = buf.readUInt16LE(lho + 28);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      try {
        out.set(name, method === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp));
      } catch { /* 깨진 엔트리는 건너뜀 */ }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
