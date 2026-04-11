import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'auth_provider.g.dart';

@riverpod
Stream<User?> authState(Ref ref) {
  return FirebaseAuth.instance.authStateChanges();
}

@riverpod
class AuthNotifier extends _$AuthNotifier {
  @override
  FutureOr<void> build() {}

  Future<void> login(String email, String password) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => FirebaseAuth.instance
          .signInWithEmailAndPassword(email: email, password: password)
          .then((_) {}),
    );
  }

  Future<void> register(String email, String password, String displayName) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final cred = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      await cred.user?.updateDisplayName(displayName);
    });
  }

  Future<void> logout() async {
    await FirebaseAuth.instance.signOut();
  }
}
