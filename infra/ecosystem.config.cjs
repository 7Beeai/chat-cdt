module.exports = {
  apps: [
    {
      name: 'chat-cdt',
      cwd: '/var/www/chat-cdt',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: { NODE_ENV: 'production' },
      out_file: '/var/log/chat-cdt/out.log',
      error_file: '/var/log/chat-cdt/err.log',
      merge_logs: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      wait_ready: false,
    },
  ],
}
