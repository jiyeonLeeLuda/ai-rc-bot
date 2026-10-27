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

// 저duty 토크 확보를 위해 주파수를 낮춤(TP101 기어모터 무부하 시작 임계 실측:
// 20kHz→0.9, 1kHz→0.8). 200Hz로 ON 시간 동안 코일 전류를 충분히 채운다.
// 구동 중 가청 소음은 감수 — 무소음이 필요해지면 주파수 대신 전압(2S→3S 불가,
// 승압)이나 모터 교체로 풀어야 함.
const uint32_t PWM_FREQ_HZ  = 200;
const uint8_t  PWM_RES_BITS = 10;     // 0~1023. 80MHz/200Hz=400000 ≥ 1024 → 유효
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
  ledcWrite(pin, 0);
#else
  // duty를 0으로 만든 "뒤에" 핀을 붙인다 — attach를 먼저 하면 초기화 전
  // 쓰레기 듀티가 찰나 모터로 나가 리셋 때마다 바퀴가 꿈틀한다(실측).
  ledcSetup(channel, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcWrite(channel, 0);
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

// 데드밴드 보정: TP101 기어모터는 무부하에서도 duty 0.5 미만이면 안 돈다(200Hz 실측).
// 명령 |v|∈(0,1]을 실듀티 [DEADBAND_MIN, 1.0]으로 선형 매핑해 저속 명령도 실제로 움직이게 한다.
const float DEADBAND_MIN = 0.55f;   // 시작 임계 0.5 + 부하 여유
const float INPUT_EPS    = 0.05f;   // 이 미만은 정지 의도로 간주

// 모터 한 개(IN1/IN2 두 핀)에 방향+듀티 적용.
void applyMotor(int pinIn1, int chIn1, int pinIn2, int chIn2, float v) {
  if (v >  1.0f) v =  1.0f;
  if (v < -1.0f) v = -1.0f;
  if (fabsf(v) < INPUT_EPS) v = 0.0f;
  float mag = (v == 0.0f) ? 0.0f : DEADBAND_MIN + fabsf(v) * (1.0f - DEADBAND_MIN);
  uint32_t duty = (uint32_t)(mag * PWM_MAX + 0.5f);
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
  Serial.printf("[vehicle] drive: TB6612 PWM init (GPIO3-6, LEDC ch0-3, %luHz 10bit)\n",
                (unsigned long)PWM_FREQ_HZ);
}

// --- 차량 방향 설정 (배선 바꾸지 않고 여기서 보정) ---
// 사용자가 정한 차량 "앞" 기준으로 W가 전진이 되도록 맞춘다.
//   DIR_SIGN: 각 모터 회전 방향 반전 (-1 = 반전)
//   SWAP_LR : 좌/우 모터 할당 교체 (앞뒤를 뒤집으면 좌우도 거울상이 되므로 보통 함께 필요)
const float DIR_SIGN_A = -1.0f;   // A채널(물리 배선 기준 모터1)
const float DIR_SIGN_B = -1.0f;   // B채널(물리 배선 기준 모터2)
const bool  SWAP_LR    = true;    // 앞 기준이 180° 뒤집혔으므로 좌우도 교체

// 좌우 모터 개체차 트림 (1.0 = 보정 없음).
// 왼쪽 드리프트의 주원인은 왼쪽 트랙 링크 1칸 과다(헐렁→슬립)로 판명 — 트랙 수리 후
// 재보정 예정이라 1.0으로 리셋. 수리 후 남는 모터 개체차만큼만 TRIM_R을 내릴 것
// (공중 0.7 duty 비교에서 왼쪽이 약간 느렸으므로 0.90~0.95 예상).
const float TRIM_L = 1.0f;
const float TRIM_R = 1.0f;

void set(float left, float right, uint32_t ttlMs) {
  if (!s_began) return;
  left  *= TRIM_L;
  right *= TRIM_R;
  float a = (SWAP_LR ? right : left)  * DIR_SIGN_A;
  float b = (SWAP_LR ? left  : right) * DIR_SIGN_B;
  applyMotor(PIN_AIN1, CH_AIN1, PIN_AIN2, CH_AIN2, a);
  applyMotor(PIN_BIN1, CH_BIN1, PIN_BIN2, CH_BIN2, b);
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

void beep(uint16_t freqHz, uint16_t ms) {
  if (!s_began || s_active) return;   // 주행 중엔 비프 금지 (타이머 공유 간섭 방지)

  // 양쪽 모터 코일을 동시에 스피커로 (코일 2개 = 음량 ↑).
  // 고주파(≥1kHz)에서 모터 구동 임계는 duty 0.8 이상(실측)이라 44%는
  // 바퀴를 못 돌리고 소리만 난다. (29%는 들리긴 하나 작았음 — 실측 상향)
  // ch0·ch1(타이머0)과 ch2·ch3(타이머1)의 주파수가 함께 바뀌지만
  // AIN2/BIN2는 duty 0이라 무음.
  const uint32_t BEEP_DUTY = 450;   // /1023 ≈ 44%
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcChangeFrequency(PIN_AIN1, freqHz, PWM_RES_BITS);
  ledcChangeFrequency(PIN_BIN1, freqHz, PWM_RES_BITS);
  ledcWrite(PIN_AIN1, BEEP_DUTY);
  ledcWrite(PIN_BIN1, BEEP_DUTY);
  delay(ms);
  ledcWrite(PIN_AIN1, 0);
  ledcWrite(PIN_BIN1, 0);
  ledcChangeFrequency(PIN_AIN1, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcChangeFrequency(PIN_BIN1, PWM_FREQ_HZ, PWM_RES_BITS);
#else
  ledcSetup(CH_AIN1, freqHz, PWM_RES_BITS);
  ledcSetup(CH_BIN1, freqHz, PWM_RES_BITS);
  ledcWrite(CH_AIN1, BEEP_DUTY);
  ledcWrite(CH_BIN1, BEEP_DUTY);
  delay(ms);
  ledcWrite(CH_AIN1, 0);
  ledcWrite(CH_BIN1, 0);
  ledcSetup(CH_AIN1, PWM_FREQ_HZ, PWM_RES_BITS);   // 주행용 200Hz 복원
  ledcSetup(CH_BIN1, PWM_FREQ_HZ, PWM_RES_BITS);
#endif
}

}  // namespace drive
