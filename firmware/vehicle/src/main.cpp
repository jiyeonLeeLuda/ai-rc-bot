// 스낵 익스프레스 차량 펌웨어 (ESP32-C3 슈퍼미니)
// gateway(cockpit) 서버에 ws://HOST:PORT/robot 으로 직접 접속하는 독립 두뇌.
// 역할: drive 명령 수신 → 모터 구동(데드맨 안전), hello/state 송신. 화면·스피커 없음.
//
// 프로토콜 정본: packages/protocol/src/index.ts (CoreS3 조종실과 동일 v0)

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "drive.h"

// config.h(자격증명)는 .gitignore. 없으면 빌드 단계에서 명확히 안내한다.
#if __has_include("config.h")
  #include "config.h"
#else
  #error "config.h가 없습니다. 'cp include/config.example.h include/config.h' 후 값을 채우세요."
#endif

// --- 핀 ---
static const int PIN_LED = 8;    // 온보드 LED (active-low: LOW=켜짐)
// 예약(이번 범위 밖): GPIO7=리드 스위치(착좌 감지), GPIO10=WS2812B LED 스트립.
//   → 다음 단계에서 state.seated 송신 / 상태 조명에 사용 예정. 지금은 건드리지 않는다.

static const int      PROTOCOL_VERSION = 0;
static const char*    FIRMWARE = "snack-express-0.1";
static const uint32_t STATE_INTERVAL_MS = 5000;   // state 송신 주기
static const uint32_t RECONNECT_MS = 5000;        // WS 재접속 백오프

static WebSocketsClient webSocket;
static bool     g_connected = false;
static uint32_t g_lastStateMs = 0;

// --- LED 헬퍼 (active-low) ---
static inline void ledOn()  { digitalWrite(PIN_LED, LOW); }
static inline void ledOff() { digitalWrite(PIN_LED, HIGH); }

// Wi-Fi 연결 중/WS 미연결이면 점멸, WS 연결됨이면 상시 점등.
static void updateStatusLed() {
  if (g_connected) {
    ledOn();
    return;
  }
  // 점멸(약 5Hz)
  ledOn();
  if ((millis() / 100) % 2 == 0) ledOff();
}

// --- 송신 ---
static const char* modeStr() {
  return drive::isActive() ? "driving" : "idle";
}

static void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["protocolVersion"] = PROTOCOL_VERSION;
  doc["robotId"] = ROBOT_ID;
  doc["firmware"] = FIRMWARE;
  JsonArray caps = doc["capabilities"].to<JsonArray>();
  caps.add("drive");   // 이 개체는 구동만 담당
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
  Serial.printf("[vehicle] -> hello (robotId=%s)\n", ROBOT_ID);
}

static void sendState() {
  JsonDocument doc;
  doc["type"] = "state";
  doc["mode"] = modeStr();
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

// --- 수신 ---
static void handleMessage(uint8_t* payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[vehicle] rx JSON error: %s\n", err.c_str());
    return;
  }
  const char* type = doc["type"] | "";

  if (strcmp(type, "drive") == 0) {
    float left  = doc["left"]  | 0.0f;
    float right = doc["right"] | 0.0f;
    uint32_t ttlMs = doc["ttlMs"] | 0;
    drive::set(left, right, ttlMs);   // ttlMs 후 데드맨 자동 정지
  } else {
    // tts.chunk / sequence / hello.ack / listen 등 — 이 개체엔 화면·스피커가 없어 무시.
    Serial.printf("[vehicle] <- %s (ignored)\n", type);
  }
}

static void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      g_connected = true;
      Serial.printf("[vehicle] connected: %s\n", (char*)payload);
      sendHello();
      g_lastStateMs = 0;   // 접속 직후 state 즉시 송신 유도
      break;
    case WStype_DISCONNECTED:
      g_connected = false;
      drive::stop();   // 연결 끊기면 즉시 정지(안전)
      Serial.println("[vehicle] disconnected");
      break;
    case WStype_TEXT:
      handleMessage(payload, length);
      break;
    case WStype_ERROR:
      Serial.println("[vehicle] ws error");
      break;
    default:
      break;
  }
}

static void connectWifi() {
  Serial.printf("[vehicle] WiFi connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    updateStatusLed();   // 연결 중 점멸
    delay(100);
  }
  WiFi.setSleep(false);  // modem sleep OFF: 실시간 제어 지연(수백 ms) 방지
  Serial.printf("[vehicle] WiFi connected: %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[vehicle] snack-express boot");

  pinMode(PIN_LED, OUTPUT);
  ledOff();

  drive::begin();   // 부팅 시 모터 정지 보장

  connectWifi();

  webSocket.begin(COCKPIT_HOST, COCKPIT_PORT, "/robot");
  webSocket.onEvent(onWsEvent);
  webSocket.setReconnectInterval(RECONNECT_MS);   // 끊기면 5초 후 재접속
  Serial.printf("[vehicle] WS target ws://%s:%d/robot\n", COCKPIT_HOST, COCKPIT_PORT);
}

void loop() {
  webSocket.loop();
  drive::tick();   // 데드맨: ttl 만료 시 정지(연결 여부 무관하게 항상 체크)

  if (g_connected) {
    uint32_t now = millis();
    if (now - g_lastStateMs >= STATE_INTERVAL_MS) {
      g_lastStateMs = now;
      sendState();
    }
  }

  updateStatusLed();
}
