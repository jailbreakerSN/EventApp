import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_theme.dart';

class FeedPage extends ConsumerWidget {
  const FeedPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fil d\'actualité')),
      body: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.rss_feed, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text(
              'Bientôt disponible',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppTheme.navy),
            ),
            SizedBox(height: 8),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 48),
              child: Text(
                'Le fil d\'actualité vous permettra de suivre les posts et mises à jour des événements.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, fontSize: 14),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
