import { Fonts } from '@/constants/theme';
import { useSecureStorage } from '@/hooks/useSecureStorage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { HCESession, NFCTagType4, NFCTagType4NDEFContentType } from 'react-native-hce';
import NfcManager, { Ndef, NdefRecord, NfcTech, TagEvent } from 'react-native-nfc-manager';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Collapsible } from './ui/collapsible';

interface ScannedItem {
  id: string;
  tagDetails: string;
  ndefMessage: NdefRecord[];
  createdAt: string;
}

const NfcScanner = () => {
  const [nfcStatus, setNfcStatus] = useState('Checking NFC availability...');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedItemsLoading, scannedItems, setScannedItems] = useSecureStorage<ScannedItem[]>('scannedNfcItems');
  const [emittingItem, setEmittingItem] = useState<string | null>(null);
  const [hceSession, setHceSession] = useState<HCESession | null>(null);
  const isCancelling = useRef(false);

  useEffect(() => {
    const initApp = async () => {
      try {
        await NfcManager.start();
        checkNfcSupport();
        if (Platform.OS === 'android') {
          const session = await HCESession.getInstance();
          setHceSession(session);
        }
      } catch (ex) {
        console.error("Error initializing NFC or HCE", ex);
        setNfcStatus(`Initialization Error`);
      }
    };
    initApp();
    return () => {
      NfcManager.cancelTechnologyRequest().catch(() => 0);
      hceSession?.setEnabled(false);
    };
  }, []);

  const checkNfcSupport = async () => {
    try {
      const isSupported = await NfcManager.isSupported();
      if (isSupported) {
        const isEnabled = await NfcManager.isEnabled();
        if (isEnabled) {
          setNfcStatus('Ready to Scan');
        } else {
          setNfcStatus('NFC is disabled');
          Alert.alert(
            'NFC Disabled',
            'NFC is required for this feature. Please enable it in settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Platform.OS === 'android' ? Linking.sendIntent('android.settings.NFC_SETTINGS') : Linking.openSettings() }
            ]
          );
        }
      } else {
        setNfcStatus('NFC not supported');
        Alert.alert('Not Supported', 'This device does not support NFC.');
      }
    } catch (ex) {
      setNfcStatus(`Error checking NFC: ${ex}`);
    }
  };

  const readNdef = async () => {
    if (isScanning) {
      isCancelling.current = true;
      try {
        await NfcManager.cancelTechnologyRequest();
      } catch (e) {
        // Ignore errors during cancellation request itself
      } finally {
        isCancelling.current = false;
      }
      setIsScanning(false);
      return;
    }

    if (emittingItem) {
      Alert.alert('Cannot Scan', 'Please stop emitting the current card before scanning.');
      return;
    }

    setIsScanning(true);
    setNfcStatus('Scanning...');
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag: TagEvent | null = await NfcManager.getTag();
      if (tag) {
        let tagDetails = '--- Tag Details ---\n';
        tagDetails += `ID: ${tag.id ? Ndef.util.bytesToHexString(tag.id) : 'N/A'}\n`;
        tagDetails += `Tech Types: ${tag.techTypes ? tag.techTypes.join(', ') : 'N/A'}\n`;
        tagDetails += `Type: ${tag.type || 'N/A'}\n`;
        tagDetails += `Max Size: ${tag.maxSize || 'N/A'} bytes\n`;

        const newItem: ScannedItem = {
          id: tag.id ? Ndef.util.bytesToHexString(tag.id) + Date.now() : Date.now().toString(),
          tagDetails: tagDetails,
          ndefMessage: tag.ndefMessage || [],
          createdAt: new Date().toISOString(),
        };

        const newItems = [newItem, ...(scannedItems || [])];
        console.log("\n\n\n",newItems)
        setScannedItems(newItems);
        setNfcStatus('Scan successful!');
      } else {
        setNfcStatus('No tag found. Try again.');
      }
    } catch (ex) {
      // Check if it's a user cancellation (common when calling cancelTechnologyRequest)
      // The error object or message might vary, but usually it contains "UserCancel" or similar
      const errorString = String(ex);
      if (isCancelling.current || errorString.includes('UserCancel') || errorString.includes('cancelled')) {
        setNfcStatus('Scan cancelled.');
      } else {
        console.warn('NFC Read Error:', ex);
        setNfcStatus('Scan failed. Please try again.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (emittingItem === id) {
      await hceSession?.setEnabled(false);
      setEmittingItem(null);
    }
    const newItems = (scannedItems || []).filter(item => item.id !== id);
    setScannedItems(newItems);
  };

  const handleEmitItem = async (item: ScannedItem) => {
    if (!hceSession) {
      Alert.alert('Error', 'HCE Session not initialized. Android only.');
      return;
    }

    if (isScanning) {
      Alert.alert('Cannot Emit', 'Please stop scanning before emitting a card.');
      return;
    }

    // Toggle off if already emitting this item
    if (emittingItem === item.id) {
      await hceSession.setEnabled(false);
      setEmittingItem(null);
      return;
    }

    console.log(item, "------------------>item");

    // Convert item.id (string) ➜ NDEF Text Record
    const ndefRecord = Ndef.textRecord(item.id);

    console.log("Generated NDEF Record:", ndefRecord);

    // Decode payload for NFCTagType4
    const decodedText = Ndef.text.decodePayload(ndefRecord.payload);

    // Create virtual NFC tag
    const tag = new NFCTagType4({
      type: NFCTagType4NDEFContentType.Text,
      content: decodedText,
      writable: false,
    });

    try {
      await hceSession.setApplication(tag);
      await hceSession.setEnabled(true);
      setEmittingItem(item.id);
    } catch (e) {
      console.error("HCE Error", e);
      Alert.alert('Emulation Error', 'Failed to start HCE session.');
    }
  };


  const renderItem = ({ item }: { item: ScannedItem }) => {
    const isEmitting = emittingItem === item.id;
    return (
      <Collapsible title={`Scan: ${new Date(item.createdAt).toLocaleString()}`}>
        <ThemedView style={styles.listItem}>
          <ThemedText style={styles.itemText}>
            {item.tagDetails}
            {(item.ndefMessage && item.ndefMessage.length > 0)
              ? '\n--- NDEF Message ---\n' + parseNdefMessage(item.ndefMessage)
              : '\nNo NDEF message found on tag.'}
          </ThemedText>
          <View style={styles.buttonGroup}>
            {Platform.OS === 'android' && (
              <View style={{ flexDirection: "column" }}>
                <TouchableOpacity
                  onPress={() => handleEmitItem(item)}
                  style={[styles.actionButton, isScanning && styles.disabledButton]}
                  disabled={isScanning}
                >
                  <MaterialCommunityIcons name="nfc-variant" color={isEmitting ? '#FF6347' : (isScanning ? '#A0A0A0' : '#007AFF')} size={30} />
                </TouchableOpacity>
                <Text style={{ textAlign: "center" }}>Emit</Text>
              </View>
            )}

            <View style={{ flexDirection: "column" }}>
              <TouchableOpacity onPress={() => handleDeleteItem(item.id)} style={styles.actionButton}>
                <MaterialCommunityIcons name="trash-can" color="red" size={30} />
              </TouchableOpacity>
              <Text style={{ textAlign: "center" }}>Emit</Text>
            </View>
          </View>
        </ThemedView>
      </Collapsible >
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.listContainer}>
        <FlatList
          data={scannedItems || []}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          ListEmptyComponent={<ThemedText style={styles.emptyText}>No scans yet.</ThemedText>}
        />
      </ThemedView>
      <TouchableOpacity
        onPress={readNdef}
        style={[
          styles.scanButton,
          isScanning ? styles.scanButtonScanning : {},
          emittingItem ? styles.disabledScanButton : {}
        ]}
        disabled={!!emittingItem}
      >
        <MaterialCommunityIcons
          name="nfc-search-variant"
          size={60}
          color={isScanning ? '#FF6347' : (emittingItem ? '#A0A0A0' : '#007AFF')}
        />
        <ThemedText type="subtitle" style={[styles.scanButtonText, emittingItem && { color: '#A0A0A0' }]}>
          {isScanning ? 'Stop Scanning' : (emittingItem ? 'Cannot Scan (Emitting)' : 'Start Scan')}
        </ThemedText>
      </TouchableOpacity>
      <ThemedText style={styles.statusText}>{nfcStatus}</ThemedText>
      {nfcStatus === 'NFC is disabled' && (
        <TouchableOpacity onPress={() => Platform.OS === 'android' ? Linking.sendIntent('android.settings.NFC_SETTINGS') : Linking.openSettings()} style={styles.settingsButton}>
          <ThemedText style={styles.settingsButtonText}>Open Settings</ThemedText>
        </TouchableOpacity>
      )}
      {emittingItem && <ThemedText style={styles.emittingStatus}>Emitting card... bring reader close.</ThemedText>}
    </ThemedView >
  );
};

const parseNdefMessage = (ndefMessage: NdefRecord | NdefRecord[]) => {
  if (!ndefMessage) return "No NDEF message found.";

  // Normalize to array
  const records = Array.isArray(ndefMessage) ? ndefMessage : [ndefMessage];

  if (records.length === 0) return "No NDEF message found.";

  let result = "";

  records.forEach((record, index) => {
    result += `Record ${index + 1}:\n`;
    result += `  TNF: ${record.tnf} (0x${record.tnf.toString(16).padStart(2, "0")})\n`;
    result += `  Type: ${Ndef.util.bytesToHexString(record.type)}\n`;

    if (record.id && record.id.length > 0) {
      result += `  ID: ${Ndef.util.bytesToHexString(record.id)}\n`;
    }

    // Decode based on record type
    if (Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_TEXT)) {
      result += `  Decoded: ${Ndef.text.decodePayload(new Uint8Array(record.payload as any))}\n`;
    } else if (Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
      result += `  Decoded: ${Ndef.uri.decodePayload(new Uint8Array(record.payload as any))}\n`;
    } else {
      result += `  Payload: ${Ndef.util.bytesToHexString(record.payload)}\n`;
    }
  });

  return result.trim();
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    borderWidth: 2,
    justifyContent: "center",
    gap: 20
  },
  scanButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#007AFF',
    marginBottom: 20,
  },
  disabledScanButton: {
    borderColor: '#A0A0A0',
  },
  disabledButton: {
    opacity: 0.5,
  },
  scanButtonScanning: {
    borderColor: '#FF6347',
  },
  scanButtonText: {
    marginTop: 10,
    fontFamily: Fonts.rounded,
  },
  statusText: {
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: Fonts.mono,
  },
  emittingStatus: {
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: Fonts.mono,
    color: '#FF6347',
    fontWeight: 'bold',
  },
  listContainer: {
    marginTop: 100,
    flex: 1,
    // borderTopWidth: 1,
    borderColor: '#ccc',
    borderWidth: 1
  },
  listItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemText: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginLeft: 16,
    width: "100%",
    paddingVertical: "5%"
  },
  actionButton: {
    padding: 14,
    backgroundColor: "rgba(222, 239, 255, 1)",
    borderRadius: 100
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 40,
    fontFamily: Fonts.mono,
  },
  settingsButton: {
    alignSelf: 'center',
    padding: 10,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    marginTop: 10,
  },
  settingsButtonText: {
    color: 'white',
    fontFamily: Fonts.rounded,
  },
});

export default NfcScanner;