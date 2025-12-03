const { withAndroidManifest, withDangerousMod, withAndroidStrings } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withHceService = (config) => {
    return withAndroidManifest(config, async (config) => {
        const androidManifest = config.modResults;
        const mainApplication = androidManifest.manifest.application[0];

        // Check if service already exists
        let service = mainApplication.service?.find(
            (s) => s.$['android:name'] === 'com.reactnativehce.services.CardService'
        );

        if (!service) {
            if (!mainApplication.service) {
                mainApplication.service = [];
            }
            mainApplication.service.push({
                $: {
                    'android:name': 'com.reactnativehce.services.CardService',
                    'android:exported': 'true',
                    'android:permission': 'android.permission.BIND_NFC_SERVICE',
                },
                'intent-filter': [
                    {
                        action: [
                            {
                                $: {
                                    'android:name': 'android.nfc.cardemulation.action.HOST_APDU_SERVICE',
                                },
                            },
                        ],
                    },
                ],
                'meta-data': [
                    {
                        $: {
                            'android:name': 'android.nfc.cardemulation.host_apdu_service',
                            'android:resource': '@xml/aid_list',
                        },
                    },
                ],
            });
        }

        return config;
    });
};

const withAidList = (config) => {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const resDir = path.join(
                config.modRequest.platformProjectRoot,
                'app/src/main/res/xml'
            );

            if (!fs.existsSync(resDir)) {
                fs.mkdirSync(resDir, { recursive: true });
            }

            const aidListPath = path.join(resDir, 'aid_list.xml');
            const aidListContent = `<?xml version="1.0" encoding="utf-8"?>
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:requireDeviceUnlock="false">
    <aid-group android:description="@string/app_name" android:category="other">
        <aid-filter android:name="F0010203040506"/>
    </aid-group>
</host-apdu-service>`;

            fs.writeFileSync(aidListPath, aidListContent);
            return config;
        },
    ]);
};

const withHce = (config) => {
    config = withHceService(config);
    config = withAidList(config);
    return config;
};

module.exports = withHce;
