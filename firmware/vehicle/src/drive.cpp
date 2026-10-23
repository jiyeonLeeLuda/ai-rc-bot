#include "drive.h"
#include <math.h>

namespace drive {

namespace {

// --- TB6612 제어핀 (ESP32-C3 슈퍼미니 배선 확정값) ---
//   왼쪽 모터(A):  AIN1=GPIO3, AIN2=GPIO4
//   오른쪽 모터(B): BIN1=GPIO5, BIN2=GPIO6
const int PIN_AIN1 = 3;
const int PIN_AIN2 = 4;
const int PIN_BIN1 = 5;
const int PIN_BIN2 = 6;

// LEDC 채널 배정. C3는 LEDC 채널 6개(0~5)·타이머 4개. ch0~3 사용.
// (arduino-esp32 2.x 채널→타이머 매핑: timer=(ch/2)%4 → ch0,1=timer0 / ch2,3=timer1)
const int CH_AIN1 = 0;
const int CH_AIN2 = 1;
const int CH_BIN1 = 2;
const int CH_BIN2 = 3;

const uint32_t PWM_FREQ_HZ  = 20000;  // 20kHz: 가청 모터 소음 저감
const uint8_t  PWM_RES_BITS = 10;     // 0~1023. 80MHz/20kHz=4000 ≥ 1024 → 유효
const uint32_t PWM_MAX = (1u << PWM_RES_BITS) - 1;

bool     s_began = false;
bool     s_active = false;
uint32_t s_expiryMs = 0;

// --- LEDC API 버전 분기 ---
// arduino-esp32 3.x는 핀 기반 API(ledcAttach/ledcWrite(pin,..)),
// 2.x는 채널 기반 API(ledcSetup+ledcAttachPin/ledcWrite(channel,..)).
// platformio.ini가 2.0.9(espressif32 6.3.2)로 핀돼 있어 실제로는 아래 2.x 경로가 쓰인다.
void pwmInit(int pin, int channel) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)channel;
  ledcAttach(pin, PWM_FREQ_HZ, PWM_RES_BITS);
#else
  ledcSetup(channel, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(pin, channel);
#endif
}

void pwmWrite(int pin, int channel, uint32_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)channel;
  ledcWrite(pin, duty);
#else
  (void)pin;
  ledcWrite(channel, duty);
#endif
}

// 모터 한 개(IN1/IN2 두 핀)에 방향+듀티 적용.
void applyMotor(int pinIn1, int chIn1, int pinIn2, int chIn2, float v) {
  if (v >  1.0f) v =  1.0f;
  if (v < -1.0f) v = -1.0f;
  uint32_t duty = (uint32_t)(fabsf(v) * PWM_MAX + 0.5f);
  if (v > 0.0f) {          // 전진: IN1 PWM / IN2 LOW
    pwmWrite(pinIn1, chIn1, duty);
    pwmWrite(pinIn2, chIn2, 0);
  } else if (v < 0.0f) {   // 후진: IN1 LOW / IN2 PWM
    pwmWrite(pinIn1, chIn1, 0);
    pwmWrite(pinIn2, chIn2, duty);
  } else {                 // 정지(coast): 둘 다 LOW
    pwmWrite(pinIn1, chIn1, 0);
    pwmWrite(pinIn2, chIn2, 0);
  }
}

}  // namespace

void begin() {
  pwmInit(PIN_AIN1, CH_AIN1);
  pwmInit(PIN_AIN2, CH_AIN2);
  pwmInit(PIN_BIN1, CH_BIN1);
  pwmInit(PIN_BIN2, CH_BIN2);
  s_began = true;
  stop();   // 부팅 기본값 = 정지
  Serial.println("[vehicle] drive: TB6612 PWM init (GPIO3-6, LEDC ch0-3, 20kHz 10bit)");
}

void set(float left, float right, uint32_t ttlMs) {
  if (!s_began) return;
  applyMotor(PIN_AIN1, CH_AIN1, PIN_AIN2, CH_AIN2, left);
  applyMotor(PIN_BIN1, CH_BIN1, PIN_BIN2, CH_BIN2, right);
  s_expiryMs = millis() + ttlMs;
  s_active = true;
}

void tick() {
  if (!s_began || !s_active) return;
  // 부호 있는 차로 millis() 래핑 안전하게 비교(ttlMs ≤ 2000이라 창 안에서 래핑 없음).
  if ((int32_t)(millis() - s_expiryMs) >= 0) {
    stop();   // 데드맨: ttl 만료 → 무조건 정지
  }
}

void stop() {
  if (!s_began) return;
  pwmWrite(PIN_AIN1, CH_AIN1, 0);
  pwmWrite(PIN_AIN2, CH_AIN2, 0);
  pwmWrite(PIN_BIN1, CH_BIN1, 0);
  pwmWrite(PIN_BIN2, CH_BIN2, 0);
  s_active = false;
}

bool isActive() { return s_active; }

}  // namespace drive
