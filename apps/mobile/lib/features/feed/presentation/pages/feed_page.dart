import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// TODO: Firestore real-time stream for feed posts
class FeedPage extends ConsumerWidget {
  const FeedPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fil d\'actualité')),
      body: const Center(child: Text('Aucune publication pour l\'instant')),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // TODO: open post creation bottom sheet
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}
