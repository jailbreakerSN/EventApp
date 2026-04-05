import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/models/event.dart';
import '../../../core/services/api_client.dart';

part 'events_provider.g.dart';

/// Search filter state for the events list.
class EventFilter {
  final String? query;
  final String? category;
  final int page;

  const EventFilter({this.query, this.category, this.page = 1});

  EventFilter copyWith({String? query, String? category, int? page}) {
    return EventFilter(
      query: query ?? this.query,
      category: category ?? this.category,
      page: page ?? this.page,
    );
  }
}

/// Current filter state — mutable via ref.read(eventFilterProvider.notifier).state
final eventFilterProvider = StateProvider<EventFilter>((_) => const EventFilter());

/// Fetches published events from the API based on current filter.
@riverpod
Future<List<Event>> eventsList(Ref ref) async {
  final filter = ref.watch(eventFilterProvider);
  final client = ref.watch(apiClientProvider);

  final data = await client.searchEvents(
    q: filter.query,
    category: filter.category,
    page: filter.page,
  );

  final items = data['data'] as List<dynamic>? ?? [];
  return items.map((e) => Event.fromJson(e as Map<String, dynamic>)).toList();
}

/// Fetches a single event by ID.
@riverpod
Future<Event> eventDetail(Ref ref, String eventId) async {
  final client = ref.watch(apiClientProvider);
  final data = await client.getEvent(eventId);
  final eventData = data['data'] as Map<String, dynamic>;
  return Event.fromJson(eventData);
}
