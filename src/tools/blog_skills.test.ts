import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseImagePayload, parsePublishPayload, containImageManifest } from './blog_skills';

describe('parseImagePayload', () => {
  it('평문 arg → content, 기본 스타일/limit', () => {
    const p = parseImagePayload('원두 클로즈업 [IMAGE: 매장 외관]');
    expect(p.content).toContain('원두');
    expect(p.draftJson).toBeUndefined();
    expect(p.imageStyle).toBe('photorealistic');
    expect(p.limit).toBe(4);
  });

  it('JSON arg(imageSlots) → draftJson 통째 보존', () => {
    const raw = JSON.stringify({ imageSlots: [{ alt: 'a', prompt: 'p' }], topic: '카페' });
    const p = parseImagePayload(raw);
    expect(p.draftJson).toBe(raw);
    expect(p.content).toBeUndefined();
    expect(p.topic).toBe('카페');
  });

  it('JSON arg(필드) → content + business_type/style/limit 반영', () => {
    const p = parseImagePayload(JSON.stringify({
      content: '본문', business_type: '음식점', image_style: 'watercolor', topic: '국밥집', limit: 20,
    }));
    expect(p.content).toBe('본문');
    expect(p.businessType).toBe('음식점');
    expect(p.imageStyle).toBe('watercolor');
    expect(p.topic).toBe('국밥집');
    expect(p.limit).toBe(8); // 8 로 클램프
  });

  it('깨진 JSON → 평문 content 폴백', () => {
    const p = parseImagePayload('{not json');
    expect(p.content).toBe('{not json');
    expect(p.limit).toBe(4);
  });

  it('limit 하한 클램프', () => {
    expect(parseImagePayload(JSON.stringify({ content: 'x', limit: 0 })).limit).toBe(4);
    expect(parseImagePayload(JSON.stringify({ content: 'x', limit: -3 })).limit).toBe(4);
  });
});

describe('parsePublishPayload', () => {
  it('final_content/image_manifest/dry_run 파싱', () => {
    const p = parsePublishPayload(JSON.stringify({
      final_content: { tags: ['a'] }, image_manifest: { images: [] }, dry_run: true,
    }));
    expect(p.finalContent).toEqual({ tags: ['a'] });
    expect(p.imageManifest).toEqual({ images: [] });
    expect(p.dryRun).toBe(true);
  });

  it('camelCase 별칭 허용', () => {
    const p = parsePublishPayload(JSON.stringify({ finalContent: { t: 1 }, dryRun: true }));
    expect(p.finalContent).toEqual({ t: 1 });
    expect(p.dryRun).toBe(true);
  });

  it('final_content 없으면 undefined(호출부가 안내 반환)', () => {
    const p = parsePublishPayload('{}');
    expect(p.finalContent).toBeUndefined();
    expect(p.dryRun).toBe(false);
  });

  it('비 JSON → 빈 페이로드', () => {
    const p = parsePublishPayload('그냥 발행해줘');
    expect(p.finalContent).toBeUndefined();
    expect(p.dryRun).toBe(false);
  });
});

describe('containImageManifest(보안 — 샌드박스 경로 컨테인먼트)', () => {
  const sb = '/tmp/sb/agent/workspace';
  const inside = path.join(sb, 'images', 'blog-image-01.png');

  it('샌드박스 하위 file_path 는 유지', () => {
    const r = containImageManifest({ images: [{ file_path: inside }] }, sb);
    expect(r.manifest.images).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it('샌드박스 밖 절대경로(시크릿 유출)는 드롭', () => {
    const r = containImageManifest({ images: [
      { file_path: '/Users/victim/.ssh/id_rsa' },
      { file_path: inside },
      { file_path: '/etc/passwd' },
    ] }, sb);
    expect(r.manifest.images).toHaveLength(1);
    expect((r.manifest.images as Array<{ file_path: string }>)[0]?.file_path).toBe(inside);
    expect(r.dropped).toBe(2);
  });

  it('.. 탈출·비문자열·누락 file_path 드롭', () => {
    const r = containImageManifest({ images: [
      { file_path: path.join(sb, '..', '..', 'secret.png') },
      { file_path: 123 },
      { alt: 'no path' },
    ] }, sb);
    expect(r.manifest.images).toHaveLength(0);
    expect(r.dropped).toBe(3);
  });

  it('images 없거나 매니페스트 아님 → 빈 images', () => {
    expect(containImageManifest({}, sb).manifest.images).toEqual([]);
    expect(containImageManifest(null, sb).manifest.images).toEqual([]);
    expect(containImageManifest('x', sb).manifest.images).toEqual([]);
  });

  it('샌드박스 접두 우회(형제 디렉토리) 차단', () => {
    // /tmp/sb/agent/workspace-evil 은 root(/tmp/sb/agent/workspace/) 접두를 만족하지 않아야 한다.
    const r = containImageManifest({ images: [{ file_path: '/tmp/sb/agent/workspace-evil/x.png' }] }, sb);
    expect(r.manifest.images).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });
});
