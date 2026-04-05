import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// TODO: implement full event detail with agenda, registration, speakers
class EventDetailPage extends ConsumerWidget {
  const EventDetailPage({super.key, required this.eventId});
  final String eventId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Détail de l\'événement')),
      body: Center(child: Text('Event: $eventId')),
    );
  }
}
