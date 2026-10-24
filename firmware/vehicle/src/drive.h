#pragma once
#include <Arduino.h>

// TB6612 2채널 모터 구동 + 데드맨 안전장치. 순수 Arduino(M5 비의존).
//
// TB6612는 STBY/PWMA/PWMB를 3.3V로 하드와이어했다는 전제이므로, 속도·방향 모두
// AIN/BIN 핀의 PWM으로 제어한다.
//   전진 = IN1 PWM / IN2 LOW,  후진 = IN1 LOW / IN2 PWM,  정지 = 둘 다 LOW(coast)
//
// 안전 원칙(데드맨): 유효한 drive 명령이 끊기면 모터는 반드시 멈춘다.
//   - set()이 지정한 ttlMs가 지나면 자동 정지
//   - WS 끊김/부팅 시에도 정지가 기본값
namespace drive {

// LEDC PWM 채널 초기화 + 정지. setup()에서 1회 호출.
void begin();

// drive 명령 적용. left/right ∈ [-1,1](부호=방향, 절대값=듀티). ttlMs 후 자동 정지.
void set(float left, float right, uint32_t ttlMs);

// 주기 호출(loop): ttl 만료 시 정지(데드맨).
void tick();

// 즉시 정지(coast). 연결 끊김/에러 경로에서 호출.
void stop();

// ttl 유효 구간이면 true (state.mode="driving" 판정).
bool isActive();

// 모터 코일을 스피커로 쓰는 비프음 (버저 없음). 움직이지 않는 미소 듀티로
// 가청 주파수 PWM을 내보낸다. 블로킹(ms 동안 delay) — 주행 중이면 무시된다.
void beep(uint16_t freqHz, uint16_t ms);

}  // namespace drive
