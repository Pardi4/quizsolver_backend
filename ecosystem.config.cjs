module.exports = {
  apps: [
    {
      name: 'quizsolver',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '700M',
      time: true
    }
  ]
};
