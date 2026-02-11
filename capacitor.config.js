/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
    appId: 'com.nicheknack.lifespeed',
    appName: 'Lifespeed',
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

module.exports = config;
