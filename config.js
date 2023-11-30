// isolated git-ignored file with production secrets:
const { configProduction } = require('./config.env.production');

const baseConfig = {
  apiPort: 3001,
  socketApiPort: 3002,
  tmpDir: './tmp/',
  aws: {
    domains: {
      frontend: 'krakowguideshop.com',
    },
  },
  email: {
    from: 'Krakow Guide Shop <kontakt@zwiedzaniekrakowa.com>',
  },
};

const configDev = {
  env: 'development',
  corsOptions: {
    origin: ['http://localhost:3000'],
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
    //       methods: ['GET', 'POST'],
  },
  ...configProduction,
};

const configProd = {
  env: 'production', // we need this to add also STAGING later
  corsOptions: {
    origin: ['https://krakowguideshop.com'],
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  },
  ...configProduction,
};

const configMap = {
  production: configProd,
  development: configDev,
};

module.exports = {
  config: {
    ...baseConfig,
    ...configMap[process.env.NODE_ENV],
  },
};
