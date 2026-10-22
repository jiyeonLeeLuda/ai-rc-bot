import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // raw ws 어댑터 적용 — ESP32는 socket.io를 이해하지 못하므로 필수.
  // WsAdapter는 path 옵션으로 게이트웨이를 /robot에 바인딩한다.
  app.useWebSocketAdapter(new WsAdapter(app));

  // 대시보드(localhost:3000)에서 REST API를 호출할 수 있도록 CORS 허용
  app.enableCors({ origin: 'http://localhost:3000' });

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`Gateway listening on port ${port}`);
  console.log(`  WS  ws://localhost:${port}/robot`);
  console.log(`  REST http://localhost:${port}/robots`);
}

bootstrap();
