module.exports = {
  apps: [
    {
      name: 'api',
      script: './index.js',
      kill_timeout: 3000,
      autorestart: true,
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
    },
  ],
};
