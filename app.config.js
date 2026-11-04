// Adds Firebase push settings only when google-services.json is present, so the app builds with or without push set up.
// Without the file, offers still reach each customer's in-app notifications; with it, they also arrive as phone notifications.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const file = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(file)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } };
};
