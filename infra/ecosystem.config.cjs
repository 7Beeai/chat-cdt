// PM2 ecosystem. A porta vem de .env.local (default 3000).
// Em VPSs onde a 3000 está ocupada, basta exportar PORT=3007 (etc.) no
// .env.local — o deploy.sh carrega antes de chamar pm2 restart.
const PORT = process.env.PORT || '3000'

module.exports = {
  apps: [
    {
      name: 'chat-cdt',
      cwd: '/var/www/chat-cdt',
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${PORT}`,
      env: { NODE_ENV: 'production', PORT },
      out_file: '/var/log/chat-cdt/out.log',
      error_file: '/var/log/chat-cdt/err.log',
      merge_logs: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      wait_ready: false,
    },
  ],
}
