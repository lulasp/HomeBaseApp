const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes('use_modular_headers!')) {
        contents = contents.replace(
          /^(platform :ios,)/m,
          "use_modular_headers!\n$1"
        );
        fs.writeFileSync(podfilePath, contents);
      }
      return config;
    },
  ]);
}

const appJson = require('./app.json').expo;

// The iOS OAuth redirect scheme is the reverse of the iOS client ID.
// e.g. "12345-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.12345-abc"
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const reverseClientId = iosClientId?.split('.').reverse().join('.');

const config = {
  ...appJson,
  ios: {
    ...appJson.ios,
    infoPlist: {
      ...appJson.ios?.infoPlist,
      CFBundleURLTypes: [
        { CFBundleURLSchemes: reverseClientId ? [reverseClientId] : [] },
      ],
    },
  },
};

module.exports = withModularHeaders(config);
