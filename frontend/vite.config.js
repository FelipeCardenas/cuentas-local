import { defineConfig } from "vite";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { outDir: "../cuentas/web-react", emptyOutDir: true },
  server: {
    proxy: {
      "/api": {
        target: process.env.CUENTAS_API_URL || "http://127.0.0.1:8765",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (req) => {
            // The backend retains its same-origin check, including during development.
            req.setHeader(
              "Origin",
              process.env.CUENTAS_API_URL || "http://127.0.0.1:8765",
            );
          });
        },
      },
    },
  },
});
