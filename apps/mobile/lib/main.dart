import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'app.dart';
import 'firebase_options.dart';

/// Set to true to connect to Firebase emulators during development.
/// The host should be your machine's IP (10.0.2.2 for Android emulator,
/// localhost for iOS simulator, or your LAN IP for physical devices).
const bool _useEmulators = kDebugMode;
const String _emulatorHost = '10.0.2.2'; // Android emulator → host machine

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // Connect to emulators in debug mode
  if (_useEmulators) {
    await _connectToEmulators();
  }

  // Hive local storage for offline data
  await Hive.initFlutter();
  await _openHiveBoxes();

  runApp(
    const ProviderScope(child: TerAngaApp()),
  );
}

Future<void> _connectToEmulators() async {
  FirebaseFirestore.instance.useFirestoreEmulator(_emulatorHost, 8080);
  await FirebaseAuth.instance.useAuthEmulator(_emulatorHost, 9099);
  FirebaseStorage.instance.useStorageEmulator(_emulatorHost, 9199);
  debugPrint('🔧 Connected to Firebase emulators at $_emulatorHost');
}

Future<void> _openHiveBoxes() async {
  await Hive.openBox<String>('auth');
  await Hive.openBox('offlineEvents');
  await Hive.openBox('checkinQueue');
  await Hive.openBox('settings');
}
