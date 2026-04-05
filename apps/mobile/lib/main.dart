import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'app.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // Crashlytics — catch Flutter errors
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };

  // Hive local storage for offline data
  await Hive.initFlutter();
  await _openHiveBoxes();

  runApp(
    // ProviderScope at the root so all Riverpod providers are accessible
    const ProviderScope(child: TerAngaApp()),
  );
}

Future<void> _openHiveBoxes() async {
  await Hive.openBox<String>('auth');
  await Hive.openBox('offlineEvents');   // stores OfflineEventData per eventId
  await Hive.openBox('checkinQueue');    // pending check-ins to sync
  await Hive.openBox('settings');
}
