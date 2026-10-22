# 스낵 익스프레스 (StackChan 프로젝트) — 프로젝트 브리프

> Claude Code 작업용 컨텍스트 문서. 기획~현재 상태 요약. (최종 갱신 2026-10-22)

## 1. 한 줄 컨셉

M5Stack CoreS3 기반 자작 스타크챤(StackChan) + 분리형 탱크 차량 "스낵 익스프레스".
평소엔 책상 위 지정석(도킹 크래들)에 앉아 AI 음성 대화·표정 미러링을 하고,
놀 때는 메탈슬러그처럼 차량 콕핏에 탑승해 간식을 배달한다.

## 2. 하드웨어

### 보유 (구매 완료)
- M5Stack CoreS3 (ESP32-S3, 16MB Flash, 8MB PSRAM, 2" 터치 LCD, 듀얼 마이크, 1W 스피커, 카메라 GC0308 0.3MP, 9축 IMU)
- MG90S 서보 ×2 (목 팬/틸트, PWM) → Port.C
- Grove 케이블 ×6, microSD(교체분 — 첫 카드는 ESP32 SPI 호환 불량이었음), USB-C 데이터 케이블, M2/M3 나사
- 미니 탱크 섀시 TP101 (알루미늄 193×163×60mm, 470g, 25mm급 기어모터 ×2 **정격 12V, 6~12V 동작**)
- 18650 배터리 + 홀더

### 주문 완료 — 배송 중 (2026-10-22)
- TB6612FNG 모터 드라이버 ×2 (2단계 필수)
- 네오디뮴 자석 8×3mm (도킹), 리드 스위치 **플라스틱 몰드형·NO 타입** (착좌 감지)
- ESP32-C3 슈퍼미니 (차량 두뇌, 3단계), WS2812B LED 스트립, 아크릴판 3mm
- 레고 부품

### 미구매
- **18650 배터리 ×2 (버튼탑, 동일품) + 전용 충전기 + 벅 컨버터(7.4V→5V, mini-360)** — 차량 구동에 필수. 배터리 도착 전에도 C3는 USB 전원으로 WS·데드맨 테스트 가능
- 아이롱비즈 5색(블랙 바탕 + 시안/마젠타/옐로/화이트) — 골판지 목업으로 치수 확정 후 주문 예정

### 배선 원칙 / 함정 (중요)
- 모터 전원(18650 ×2 직렬 = 7.4V)과 CoreS3는 완전 분리, **GND만 공통**
- TB6612: VM=차량 배터리, VCC=3.3V, **STBY·PWMA·PWMB는 3.3V에 묶기**, AIN/BIN 4핀에 PWM. 상한 13.5V
- 18650 **3개 직렬 금지**
- Wi-Fi는 **2.4GHz만** 가능
- SD카드: FAT32 + **MBR 파티션**, 루트에 `wifi.txt`(SSID/PW 2줄), `apikey.txt`(OpenAI키/VoiceVox키/OpenAI키 3줄). 메이저 브랜드 32GB 이하 카드 권장
- CoreS3 다운로드 모드: 뒷면 리셋 버튼 3초 홀드 → 초록 LED
- macOS: M5Burner는 게이트키퍼 "그래도 열기" 필요. 포트 확인 `ls /dev/tty.usbmodem*`

## 3. 로드맵 (각 단계가 그대로 완성품)

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 표준 스타크챤: 얼굴 + AI 음성 대화 + 목 2축 | **음성 대화 동작 확인** (서보 셸 미장착) |
| 1.5 | 도킹 크래들(레고): 홈 치수·자석 위치 = 마스터 규격. 책상 지정석 겸 충전 스테이션 | 미착수 |
| 2 | ~~유선 제어~~ → **3단계 직행으로 변경** (GPIO2 카메라 충돌 + 차량 독립성) | 건너뜀 |
| 3 | **무선**: 차량에 ESP32-C3 탑재(TB6612: GPIO3~6), cockpit WS 프로토콜 재사용. 리드 스위치(GPIO7)·LED(GPIO10)는 후속 | **진행 중** — 섀시 조립 완료, 모터 납땜 중. 차량 펌웨어 `firmware/vehicle/`. 조립 가이드 v2 = docs/ |
| 4 | 소프트웨어 확장: 미러 모드 고도화, 사무실 모드, 워치 연동 | **미러 모드 서버 이관 완료** |

### 조종실(cockpit) 아키텍처 — 2026-10-22 실기 검증 완료
- 모노레포(이 리포): protocol(zod)·gateway(NestJS :3001)·dashboard(Next :3000)·mock-robot
- 로봇 펌웨어 `feature/cockpit-ws` 브랜치: WS 상시접속, hello/state/touch 송신,
  sequence·tts.chunk 재생, 재접속 5초, WiFi 절전 OFF. SD `SC_ExConfig.yaml`의
  `cockpit.host`(=맥 IP)로 활성화, 미설정 시 단독 동작
- 미러 모드: cockpit 연결 시 camera.frame(VGA JPEG) 서버 전송 → 서버 분류(1~2.5초)
  → sequence 하달. 온디바이스 TLS 제거로 HeapGuard 메모리 문제 해소 (실기 확인)
- 음성 파이프라인 서버 기준선: stt 2.6s / llm 2.8s / tts 1.8s / 총 7.2s (mock-robot E2E)
- 다음 후보: 마이크 스트리밍(음성 턴 서버 이관), drive 펌웨어, cockpit 설정 웹 UI화

## 4. 디자인 (확정: v7 「BLACK CYBER ROADSTER」)

- 사이버트럭 웨지 노즈 + **오픈 콕핏**(머리가 운전사처럼 노출) + 오픈 베드(간식 적재, 테일게이트 반개)
- 블랙 바디 + 시안/마젠타 네온 포인트. 할로 롤바 = 목 서보 브래킷 커버 겸용
- 윈드실드 = 아크릴 + 하단 WS2812B 엣지라이트 (표정 연동: 평소 시안, 간식 적재 마젠타)
- 외장 전략: **골판지 목업 → 치수 확정 → 아이롱비즈 패널 + 아크릴 재단**. 뼈대/관절/탈착부만 레고
- 원칙: 움직이거나·하중 받거나·탈착되는 곳 = 레고 / 보이는 면 = 비즈 / 투명 = 아크릴
- 머리 셸: 비즈 외피 + 틸트 서보 브래킷만 출력물 또는 테크닉 빔 (비즈는 하중 불가)

## 5. 소프트웨어

### 현재 펌웨어
- **실제 소스: `~/Documents/work/stackchan/AI_StackChan_Ex/firmware`** (미러 모드·윙크·TLS 재사용 커밋 포함 개조본. DevCam 체크아웃도 옆에 있으나 그쪽은 미개조 원본)
- 빌드: PlatformIO env `m5stack-cores3`, 산출물 `.pio/build/m5stack-cores3/` (bootloader 0x0 / partitions 0x8000 / boot_app0 0xe000 / firmware 0x10000)
- 복구 이력(2026-10-22): 장기 방치 후 부팅 불능(검은 화면) → 플래시 **전체 삭제(erase-flash)** 후 재플래시로 해결. 앱 영역만 다시 쓰면 안 살아남 — NVS 등 데이터 영역이 깨진 경우 전체 삭제가 필요. 공장 데모(M5Burner 캐시의 CoreS3 UserDemo)로 하드웨어 생사 판별 가능
- STT: Whisper(OpenAI) / LLM: OpenAI / TTS: **VoiceVox 즌다몬(일본어 전용 — 한국어 미지원이 현안)**
- 미러 모드 v0.1 사용법: 화면 중앙 터치 또는 "미러 모드" → ON/OFF. ON 시 ~2.5초 간격 클라우드 표정 분류 → 따라 웃음. 블로우키스/손흔들기/손하트 리액션. 이마 터치+"빵야!"/"훅!" 리액션. 왼쪽 가장자리 터치 = 무음 모드

### 알려진 문제 (재가동 시 최우선)
- **느림**: STT→LLM→TTS 3회 HTTPS 순차 호출(ESP32 TLS 핸드셰이크 비용) + 비전 폴링이 동시에 라디오/CPU 점유
- 조치 계획: ① 단계별 타이밍 로그 계측 → ② 표정 분류를 **온디바이스 FER 모델**(48×48 그레이 CNN, int8, TFLite Micro/ESP-DL)로 이전 → ③ 음성은 keep-alive·스트리밍 또는 **OpenAI Realtime API**로 전환 검토 → ④ 음성 턴 중 비전 폴링 금지
- TTS 한국어화: `gpt-4o-mini-tts`(한국어 지원, `instructions`로 말투 제어) + STT `gpt-4o-mini-transcribe`($0.003/분)로 통합 예정

### 미러 모드 리액션 테이블 (정본)
| 사용자 | 스타키 |
|---|---|
| 🙂 웃음 / 😮 놀람 / 😉 윙크 | 따라 함 (윙크는 최고 난이도) |
| 💋 블로우 키스 | 😳 → 💕 → 부끄러워함 (+LED 마젠타) |
| 👉🔫 빵야 | 😨 → 움찔 → 목 젖힘 → X_X 쓰러짐 (탑승 시 차량 뒤로 주춤) |
| 🏹 훅! | 👀 → 비틀 → @_@ "으윽" |
| 👋 손 흔들기 | 목 팬 좌우 인사 |
| ❤️ 하트 | 하트 출력 |
| 그 외 | 표정 미러링 |

### 목표 아키텍처 (씬 클라이언트)
```
[로봇 CoreS3/C++]  ←MQTT→  [조종실: TS 게이트웨이 + Python ML]  ←→  [OpenAI, Slack, 캘린더, 워치]
 표정·서보·센서만.           모든 판단. 리액션은 데이터(sequence 명령)로 하달
 온디바이스 FER 추가
```
- 로봇은 판단하지 않는다. `sequence` 명령(표정·시간·서보각·사운드 배열)을 재생만
- 제스처(손)는 서버 인식, 표정은 온디바이스. 커스텀 학습 모델(Edge Impulse/Keras→TFLite int8)로 1층 업그레이드 계획
- 인터뷰 포트폴리오 겸용: 레이어 분리, ADR 5개(왜 MQTT·씬클라이언트·데이터화된 리액션·TS+Py·우선순위 정책), 단위/통합 테스트, 모의 로봇 클라이언트

### 사무실 모드 (4단계)
Slack 멘션 얼굴화, 회의 10분 전 알림, 클로드 사용량 게이지(API usage 필드 누적), 상태 표시등(집중 모드). 안드로이드 워치 → MQTT 브로커 → 로봇/차량 명령

## 6. 참고
- 디자인 파일: `tank_stackchan_design_v7_roadster.html` (v1~v6 탐색본 별도)
- 설계 프롬프트: `조종실_설계_프롬프트.md`
- 펌웨어 기반: https://github.com/robo8080/AI_StackChan2 · https://github.com/ronron-gh/AI_StackChan2_DevCam · https://github.com/ronron-gh/AI_StackChan_Ex
- MCP 브리지 참고: https://github.com/kisaragi-mochi/stackchan-mcp (PC 상주 필요, 공식 완제품 기준 — 후순위)
- 타카오판 셸 STL/조립: https://raspberrypi.mongonta.com/how-to-build-easy-stackchan-m5gobottom/
