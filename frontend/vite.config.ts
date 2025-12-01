import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // API Gateway (Spring Cloud Gateway) - 기본 포트 8112
  const apiGatewayUrl = env.VITE_API_BASE_URL || "http://localhost:8112";
  // Browser-Use API - 기본 포트 8500
  const browserUseUrl = env.VITE_BROWSER_USE_URL || "http://localhost:8500";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        // API Gateway - Main backend API (Spring Cloud Gateway)
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
        // Browser-Use API - AI automation with human-in-the-loop
        "/browse": {
          target: browserUseUrl,
          changeOrigin: true,
          secure: false,
        },
        "/jobs": {
          target: browserUseUrl,
          changeOrigin: true,
          secure: false,
        },
        "/health": {
          target: browserUseUrl,
          changeOrigin: true,
          secure: false,
        },
        // WebSocket for browser automation real-time updates
        "/ws": {
          target: browserUseUrl.replace(/^http/, "ws"),
          changeOrigin: true,
          ws: true,
          secure: false,
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
