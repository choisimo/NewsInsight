import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // API Gateway (Spring Cloud Gateway) - 포트 8000
  // 프로덕션: docker-compose에서 api-gateway:8000
  // 개발: 로컬에서 실행 시 localhost:8000
  const apiGatewayUrl = env.VITE_API_BASE_URL || "http://localhost:8000";
  
  // Cloudflare Tunnel 환경인지 확인 (환경변수로 제어)
  const isCloudflareTunnel = env.VITE_CLOUDFLARE_TUNNEL === 'true';

  return {
    server: {
      host: "::",
      port: 8080,
      allowedHosts: ["news.nodove.com", "localhost", "127.0.0.1", "frontend"],
      // Cloudflare Tunnel 환경에서 CORS 허용
      cors: true,
      // HMR 설정 - Cloudflare Tunnel 환경에서만 외부 호스트로 설정
      // 로컬 개발 환경에서는 기본값 사용 (localhost)
      hmr: isCloudflareTunnel
        ? {
            host: "news.nodove.com",
            protocol: "wss",
            clientPort: 443,
          }
        : true, // 로컬: 기본 HMR 설정 사용
      proxy: {
        // API Gateway - 모든 /api/** 요청을 게이트웨이로 프록시
        // 게이트웨이가 내부적으로 각 서비스로 라우팅:
        //   /api/v1/** -> collector-service
        //   /api/browser-use/** -> browser-use-api (StripPrefix=2 적용)
        "/api": {
          target: apiGatewayUrl,
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: (proxy, _options) => {
            proxy.on("error", (err, _req, _res) => {
              console.log("[Proxy Error] /api:", err.message);
            });
            proxy.on("proxyReq", (_proxyReq, req, _res) => {
              console.log("[Proxy] /api:", req.method, req.url, "->", apiGatewayUrl);
            });
          },
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
