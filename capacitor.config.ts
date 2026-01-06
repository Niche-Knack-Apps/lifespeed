import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.nicheknack.atthespeedoflife',
    appName: 'At the Speed of Life',
    webDir: 'renderer',
    server: {
        androidScheme: 'https'
    },
    plugins: {
        SplashScreen: {
            launchShowDuration: 500,
            backgroundColor: '#1a1a1a',
            showSpinner: false
        },
        Keyboard: {
            resize: 'body',
            resizeOnFullScreen: true
        }
    },
    android: {
        allowMixedContent: false,
        captureInput: true,
        webContentsDebuggingEnabled: true
    }
};

export default config;
