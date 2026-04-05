import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/models/registration.dart';
import '../../../core/services/api_client.dart';

part 'registration_provider.g.dart';

/// Fetches the current user's registrations.
@riverpod
Future<List<Registration>> myRegistrations(Ref ref) async {
  final client = ref.watch(apiClientProvider);
  final data = await client.getMyRegistrations();
  final items = data['data'] as List<dynamic>? ?? [];
  return items.map((e) => Registration.fromJson(e as Map<String, dynamic>)).toList();
}

/// Handles registration mutations (create, cancel).
@riverpod
class RegistrationNotifier extends _$RegistrationNotifier {
  @override
  FutureOr<void> build() {}

  Future<Registration> register({
    required String eventId,
    required String ticketTypeId,
  }) async {
    state = const AsyncLoading();
    final client = ref.read(apiClientProvider);
    final data = await client.createRegistration(
      eventId: eventId,
      ticketTypeId: ticketTypeId,
    );
    final reg = Registration.fromJson(data['data'] as Map<String, dynamic>);

    // Invalidate registrations list so it refetches
    ref.invalidate(myRegistrationsProvider);
    state = const AsyncData(null);
    return reg;
  }

  Future<void> cancel(String registrationId) async {
    state = const AsyncLoading();
    final client = ref.read(apiClientProvider);
    await client.cancelRegistration(registrationId);
    ref.invalidate(myRegistrationsProvider);
    state = const AsyncData(null);
  }
}
