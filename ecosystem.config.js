module.exports = {
  apps: [
    {
      name: "orbit-web",
      script: "npm",
      args: "start",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "1G",
      exp_backoff_restart_delay: 100,
    },
    {
      name: "orbit-terminal",
      script: "./dist/server/terminal-bridge.js",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        ORBIT_WS_PORT: 3001,
      },
      max_memory_restart: "512M",
      exp_backoff_restart_delay: 100,
    },
    {
      name: "orbit-proxy",
      script: "./dist/server/proxy.js",
      cwd: "./",
      env: {
        NODE_ENV: "production",
        ORBIT_PROXY_PORT: 3002,
      },
    },
  ],
};
