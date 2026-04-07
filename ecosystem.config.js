module.exports = {
  apps: [
    {
      name: 'vehicle-erp-api',
      cwd: './backend',
      script: 'src/index.js',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful restart: wait 5s for connections to close
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Auto-restart on crash with exponential backoff
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'vehicle-erp-worker',
      cwd: './backend',
      script: 'src/worker.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      exp_backoff_restart_delay: 100,
    },
  ],
};
