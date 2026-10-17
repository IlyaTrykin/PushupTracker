import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Приложения для iPhone и Android (Capacitor 8). Интерфейс — статическая сборка из `out/`
 * (`npm run build:native`), сервер — только API по адресу из локального env `NATIVE_API_BASE`
 * (в git не попадает). Origin страницы — `capacitor://localhost` (iOS) и `https://localhost`
 * (Android): они же разрешены в CORS сервера (`NATIVE_APP_ORIGINS`).
 */
const apiBase = (process.env.NATIVE_API_BASE || '').trim();

const config: CapacitorConfig = {
  appId: 'app.pushuptracker.mobile',
  appName: 'Pushup Tracker',
  webDir: 'out',
  server: {
    iosScheme: 'capacitor',
    androidScheme: 'https',
    hostname: 'localhost',
  },
  android: {
    // Отладка против локального сервера по http (эмулятор → 10.0.2.2): страница на
    // https://localhost иначе не пустит запросы к http. Для https-сервера выключено.
    allowMixedContent: apiBase.startsWith('http://'),
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    // Шапка интерфейса белая: тёмный текст строки состояния; отступы — env(safe-area-inset-*).
    StatusBar: {
      style: 'LIGHT',
    },
  },
};

export default config;
