// Firebase configuration for Teranga mobile app.
// Uses the real Firebase project (teranga-app-990a8).
// Emulator connection is handled in main.dart based on build config.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return android; // Fallback for desktop/web during development
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBq_HtTysOank3j9X6QROE9oPUKyHZyTFw',
    appId: '1:784468934140:web:ceff0f6ed59860582c8679',
    messagingSenderId: '784468934140',
    projectId: 'teranga-app-990a8',
    storageBucket: 'teranga-app-990a8.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBq_HtTysOank3j9X6QROE9oPUKyHZyTFw',
    appId: '1:784468934140:web:ceff0f6ed59860582c8679',
    messagingSenderId: '784468934140',
    projectId: 'teranga-app-990a8',
    storageBucket: 'teranga-app-990a8.firebasestorage.app',
    iosBundleId: 'com.teranga.events',
  );
}
