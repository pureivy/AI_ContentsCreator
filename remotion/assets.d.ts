/** webpack asset/resource 로 들어오는 폰트 — 번들이 emit 한 URL 문자열이 된다. */
declare module '*.woff2' {
  const url: string;
  export default url;
}
/** webpack asset/resource 로 들어오는 그림(비온이 스프라이트) — 번들이 emit 한 URL 문자열. */
declare module '*.webp' {
  const url: string;
  export default url;
}
