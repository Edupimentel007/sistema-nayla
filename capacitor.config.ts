import type { CapacitorConfig } from '@capacitor/cli'

// The packaged app uses local UI assets. API calls point to a separately hosted
// HTTPS backend through VITE_API_ORIGIN at build time.
const config: CapacitorConfig = {
  appId: 'com.edupimentel.nayla',
  appName: 'Nayla',
  webDir: 'dist',
}

export default config
