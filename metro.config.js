const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Firebase v12 ships separate bundles per environment.
// Without this, Metro resolves @firebase/auth to dist/node/index.js (Node.js bundle)
// via the "main" field, causing "Expected a class definition" at runtime.
// We force it to the React Native bundle (dist/rn/index.js) explicitly.
const firebaseAuthRN = path.resolve(
  __dirname,
  'node_modules/@firebase/auth/dist/rn/index.js'
);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform !== 'web' &&
    (moduleName === '@firebase/auth' || moduleName === 'firebase/auth')
  ) {
    return { filePath: firebaseAuthRN, type: 'sourceFile' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
