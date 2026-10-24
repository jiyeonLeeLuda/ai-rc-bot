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

// --- 멀티 네트워크 (우선순위 순) ---
// 부팅 시 스캔해서 목록의 앞 순서부터 보이는 네트워크에 접속한다.
// 집은 고정 IP(DHCP 유실 우회), 핫스팟은 DHCP. cockpit 서버 IP도 네트워크별로 다름.
struct NetConfig {
  const char* ssid;
  const char* pass;
  const char* cockpitHost;
  bool        useStaticIp;
};
static const NetConfig NETWORKS[] = {
  { WIFI_SSID,  WIFI_PASS,  COCKPIT_HOST,  true  },   // 1순위: 집
  { WIFI2_SSID, WIFI2_PASS, COCKPIT2_HOST, false },   // 2순위: 폰 핫스팟
};
static const int  NETWORK_COUNT = sizeof(NETWORKS) / sizeof(NETWORKS[0]);
static const char* g_cockpitHost = COCKPIT_HOST;   // connectWifi()에서 확정

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
    // 수신 확인용(스팸 방지 500ms 스로틀). 주행 검증 끝나면 지워도 됨.
    static uint32_t lastLogMs = 0;
    if (millis() - lastLogMs > 500) {
      lastLogMs = millis();
      Serial.printf("[vehicle] <- drive L=%.2f R=%.2f ttl=%lu\n", left, right, (unsigned long)ttlMs);
    }
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

// 스캔 결과에서 우선순위가 가장 높은 등록 네트워크를 고른다. 없으면 -1.
static int pickNetwork() {
  Serial.println("[vehicle] WiFi scan...");
  int n = WiFi.scanNetworks();
  int best = -1;
  for (int i = 0; i < n; i++) {
    for (int k = 0; k < NETWORK_COUNT; k++) {
      if (WiFi.SSID(i) == NETWORKS[k].ssid && (best < 0 || k < best)) best = k;
    }
    Serial.printf("[vehicle]   %s (ch%d, %ddBm)\n",
                  WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i));
  }
  WiFi.scanDelete();
  return best;
}

static void connectWifi() {
  WiFi.mode(WIFI_STA);

  // C3 슈퍼미니 안테나 매칭 문제 회피: 기본 TX 출력(19.5dBm)에서는 접속 자체가
  // 실패하는 개체가 많다. 8.5dBm으로 낮추면 붙는 것이 알려진 해법.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);

  // 등록된 네트워크가 보일 때까지 스캔 반복 (1순위 우선)
  int pick;
  while ((pick = pickNetwork()) < 0) {
    Serial.println("[vehicle] 등록된 네트워크 없음 — 3초 후 재스캔");
    for (int i = 0; i < 30; i++) { updateStatusLed(); delay(100); }
  }
  const NetConfig& net = NETWORKS[pick];
  g_cockpitHost = net.cockpitHost;

  if (net.useStaticIp) {
    // DHCP 우회(고정 IP): 이 C3 개체는 송신이 약해 핸드셰이크는 재시도로 통과하지만
    // DHCP 요청이 유실돼 GOT_IP까지 못 간다(집 공유기 실측). 고정 IP로 DHCP 단계를 제거.
    WiFi.config(IPAddress(192, 168, 0, 223), IPAddress(192, 168, 0, 1),
                IPAddress(255, 255, 255, 0), IPAddress(192, 168, 0, 1));
  }

  Serial.printf("[vehicle] WiFi connecting to %s (%s, cockpit=%s)\n",
                net.ssid, net.useStaticIp ? "static IP" : "DHCP", g_cockpitHost);
  WiFi.begin(net.ssid, net.pass);
  // begin() 이전 호출은 드라이버 기동 전이라 무시되는 개체가 있어 직후에 한 번 더.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    updateStatusLed();   // 연결 중 점멸
    delay(100);
    if (millis() - t0 > 3000) {   // 3초마다 상태 코드만 출력.
      // 수동 re-begin은 금지: 핸드셰이크 재시도로 STA_CONNECTED까지 간 연결을
      // DHCP(GOT_IP) 직전에 끊어버리는 자충수였음(reason 8 ASSOC_LEAVE 실측).
      // 재접속은 코어의 자동 reconnect에 맡긴다.
      Serial.printf("[vehicle] WiFi status=%d (0=IDLE 1=NO_SSID 4=CONN_FAIL 6=WRONG_PW/DISCONN)\n",
                    WiFi.status());
      t0 = millis();
    }
  }
  WiFi.setSleep(false);  // modem sleep OFF: 실시간 제어 지연(수백 ms) 방지
  Serial.printf("[vehicle] WiFi connected: %s (RSSI %ddBm)\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[vehicle] snack-express boot");

  pinMode(PIN_LED, OUTPUT);
  ledOff();

  drive::begin();   // 부팅 시 모터 정지 보장

  connectWifi();

  webSocket.begin(g_cockpitHost, COCKPIT_PORT, "/robot");
  webSocket.onEvent(onWsEvent);
  webSocket.setReconnectInterval(RECONNECT_MS);   // 끊기면 5초 후 재접속
  Serial.printf("[vehicle] WS target ws://%s:%d/robot\n", g_cockpitHost, COCKPIT_PORT);
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
