const path = require("node:path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "server_vai",
      cwd: root,
      script: "node",
      args: "scripts/prod.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "4G",
      kill_timeout: 30_000,
      env: {
        NODE_ENV: "production",
        API_URL: "http://127.0.0.1:4000",
      },
    },
  ],
};
