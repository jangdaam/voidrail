// 자체 신호 서버 (선택). 공용 Nostr 릴레이 대신 쓰고 싶을 때, 또는 로컬 테스트용.
//   npm install && npm run relay
//   게임 주소에 ?signal=ws://localhost:8787 을 붙여 접속
import { createWsRelayServer } from '@trystero-p2p/ws-relay/server';

const port = +(process.env.PORT || 8787);
const relay = createWsRelayServer({ port });
await relay.ready;
console.log(`Voidrail 신호 서버: ws://localhost:${port}`);
