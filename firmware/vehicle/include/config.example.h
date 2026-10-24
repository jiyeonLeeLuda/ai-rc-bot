#pragma once
//
// 이 파일을 같은 디렉터리의 config.h로 복사한 뒤 실제 값을 채우세요.
//   cp include/config.example.h include/config.h
// config.h는 .gitignore에 등록돼 있어 커밋되지 않습니다(자격증명 보호).
//
// 네트워크는 우선순위 순으로 2개 등록: 부팅 시 스캔해서 먼저 보이는 쪽에 접속.
//   1순위(집): 고정 IP 사용 — C3 슈퍼미니 개체의 DHCP 유실 문제 우회 (main.cpp 참고)
//   2순위(핫스팟): DHCP — 외부에서 주행 테스트할 때. 아이폰은 "호환성 극대화" ON(2.4GHz)
//

// --- 1순위: 집 ---
#define WIFI_SSID     "your-wifi-ssid"      // 2.4GHz만 지원
#define WIFI_PASS     "your-wifi-password"
#define COCKPIT_HOST  "192.168.1.50"        // 이 네트워크에서의 gateway 서버 IP (맥 IP)

// --- 2순위: 폰 핫스팟 ---
#define WIFI2_SSID    "your-hotspot-ssid"
#define WIFI2_PASS    "your-hotspot-password"
#define COCKPIT2_HOST "172.20.10.2"         // 핫스팟에서의 맥 IP (아이폰 첫 기기는 보통 172.20.10.2)

#define COCKPIT_PORT  3001
#define ROBOT_ID      "snack-express"       // hello.robotId
