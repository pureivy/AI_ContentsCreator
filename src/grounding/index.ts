/**
 * 그라운딩 커넥터 등록 진입점 — 이 모듈을 import 하면 모든 커넥터가 레지스트리에 등록된다.
 * 새 소스 추가: src/grounding/<source>.ts 작성 후 아래에 한 줄 import.
 */
import './law';    // 법제처(법령) — 코드 커넥터
import './dart';   // DART(전자공시) — 코드 커넥터
import './custom'; // 선언형(설정/AI 자동설정) 커넥터 — connectors.json 동적 로드

export { connectors, connectorKeyDefs, registerConnector } from './registry';
export type { GroundingConnector, ConnectorKeyDef } from './registry';
