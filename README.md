# 스낵 익스프레스 — 조종실 (Cockpit Server)

M5Stack CoreS3 스타크챤 로봇의 두뇌를 서버로 옮긴 씬 클라이언트 아키텍처.
로봇은 판단하지 않는다 — 표정·서보·센서 입출력만 하고, 모든 판단은 이 서버가 한다.

```
[스타키 CoreS3] ─┐                      ┌─→ [dashboard: Next.js :3000]
[탱크 차량 C3]  ─┴─WebSocket→ [gateway: NestJS :3001] ─REST─┘
                                    │
                                 OpenAI (STT·LLM·TTS·Vision)
```

두 로봇(얼굴 담당 스타키 + 주행 담당 차량)이 같은 서버에 붙고, 대시보드의 통합
컨트롤러가 능력(capabilities)에 따라 명령을 자동 분배한다. 착좌 → 주행모드 선글라스,
클락션 같은 멀티 로봇 연출은 `apps/gateway`의 SceneService가 조율한다.

## 리포 구성 (세트)

이 프로젝트는 두 리포로 나뉜다:

| 리포 | 내용 |
|---|---|
| **jiyeonLeeLuda/ai-rc-bot** (이 리포) | 조종실 서버·대시보드·프로토콜 + 차량(ESP32-C3) 펌웨어(`firmware/vehicle`) |
| [**jiyeonLeeLuda/AI_StackChan_Ex**](https://github.com/jiyeonLeeLuda/AI_StackChan_Ex/tree/feature/cockpit-ws) `feature/cockpit-ws` | 스타키(CoreS3) 로봇 펌웨어 — WS 클라이언트, 미러모드, 선글라스/EyeFX 연출. ronron-gh 원본(MIT) 포크 |

제작 가이드(부품 구매~첫 주행, 공유용): [`docs/build-guide-share.pdf`](docs/build-guide-share.pdf)

## 패키지

| 경로 | 이름 | 역할 |
|---|---|---|
| `packages/protocol` | `@snack-express/protocol` | 로봇↔서버 메시지 스키마(zod) — **계약의 정본** |
| `apps/gateway` | `@snack-express/gateway` | NestJS. 로봇 WS 접속(`:3001/robot`), 음성 파이프라인, 리액션·씬 하달, 드라이브 중계 |
| `apps/dashboard` | `@snack-express/dashboard` | Next.js(`:3000`). 연결 기기 모니터 + 통합 컨트롤러(능력 기반 라우팅) |
| `firmware/vehicle` | — | 탱크 차량 ESP32-C3 펌웨어(PlatformIO). drive·착좌 감지·모터 비프·멀티 네트워크 |
| `tools/mock-robot` | `@snack-express/mock-robot` | 하드웨어 없이 개발하기 위한 가짜 로봇 CLI |

## 시작하기

```bash
nvm use            # Node 22
pnpm install
pnpm build

pnpm dev:gateway   # 터미널 1 — :3001
pnpm mock-robot    # 터미널 2 — 가짜 로봇 접속
pnpm dev:dashboard # 터미널 3 — :3000
```

대시보드에서 mock-stacky가 보이면 리액션 버튼으로 sequence 명령이
mock-robot 터미널에 재생되는 것까지가 end-to-end 확인.

## 설계 원칙

- **데이터화된 리액션**: 리액션은 코드가 아니라 데이터(`sequence` 스텝 배열). 로봇 펌웨어 수정 없이 서버에서 리액션 추가.
- **데드맨 스위치**: 모든 drive 명령은 `ttlMs` 필수. 서버·Wi-Fi가 죽어도 차량은 ttl 만료 시 정지.
- **mock-robot 우선**: 실물 펌웨어를 고치기 전에 모의 클라이언트로 서버를 완성한다.

프로젝트 전체 브리프(하드웨어·로드맵·배선)는 `CLAUDE.md` 참고.
