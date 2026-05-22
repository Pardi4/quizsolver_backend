const path = require('path');

module.exports = {
  apps: [
    {
      name: 'quizsolver',
      script: './scripts/pm2-autoupdate-start.cjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PM2_AUTO_UPDATE: 'true',
        PM2_GIT_STRATEGY: 'hard',
        FRONTEND_DIR: path.join(__dirname, '..', 'frontend')
      },
      max_memory_restart: '700M',
      time: true
    }
  ]
};
