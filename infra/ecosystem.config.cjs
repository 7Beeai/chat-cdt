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
      // Cluster: o webhook da Meta chega a 6–7 mil chamadas/min nos slots do
      // motor e 1 processo saturava (health check >6s, 502/504). Next é
      // stateless; o que é em memória (cache de chat_phone_numbers, limite de
      // tentativas do esqueci-senha) passa a ser por instância, o que é
      // aceitável. PM2 balanceia na mesma porta.
      exec_mode: 'cluster',
      instances: 2,
      out_file: '/var/log/chat-cdt/out.log',
      error_file: '/var/log/chat-cdt/err.log',
      merge_logs: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      wait_ready: false,
    },
  ],
}
