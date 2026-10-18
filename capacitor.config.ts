import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Приложения для iPhone и Android (Capacitor 8). Интерфейс — статическая сборка из `out/`
 * (`npm run build:native`), сервер — только API по адресу из локального env `NATIVE_API_BASE`
 * (в git не попадает). Origin страницы — `capacitor://localhost` (iOS) и `https://localhost`
 * (Android): они же разрешены в CORS сервера (`NATIVE_APP_ORIGINS`).
 */
const config: CapacitorConfig = {
  appId: 'app.pushuptracker.mobile',
  appName: 'Pushup Tracker',
  webDir: 'out',
  // Мост Capacitor по умолчанию пишет в logcat / лог Xcode аргументы и ответы плагинов — среди них
  // токен сессии (SecureToken) и заголовок Authorization (BackgroundUpload). Логи моста выключены
  // во всех сборках.
  loggingBehavior: 'none',
  server: {
    iosScheme: 'capacitor',
    androidScheme: 'https',
    hostname: 'localhost',
  },
  // Смешанный контент (https-страница → http-сервер) нужен только отладке на эмуляторе
  // (NATIVE_API_BASE=http://10.0.2.2:...). В конфиг, который уходит в релиз, он не попадает ни при
  // каком NATIVE_API_BASE: отладочная копия конфига с allowMixedContent собирается в
  // android/app/build.gradle (задача debugCapacitorConfig) только для debug.
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
