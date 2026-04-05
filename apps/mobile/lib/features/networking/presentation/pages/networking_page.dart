import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// TODO: List participants at current event, enable messaging
class NetworkingPage extends ConsumerWidget {
  const NetworkingPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Réseautage')),
      body: const Center(child: Text('Participants de l\'événement')),
    );
  }
}
