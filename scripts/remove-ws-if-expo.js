const { execSync } = require('child_process');
const fs = require('fs');

try {
  // Check if the environment is Expo
  if (fs.existsSync('node_modules/expo')) {
    console.log("Expo environment detected. Removing 'ws'...");
    execSync('npm uninstall ws', { stdio: 'inherit' });
  } else {
    console.log("Non-Expo environment. Keeping 'ws'.");
  }
} catch (error) {
  console.error("Error during postinstall script:", error);
}
