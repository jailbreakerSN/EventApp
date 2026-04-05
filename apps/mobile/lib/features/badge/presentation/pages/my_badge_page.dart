import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../../core/theme/app_theme.dart';

// TODO: fetch real registration + badge data from Riverpod provider
class MyBadgePage extends ConsumerWidget {
  const MyBadgePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Placeholder QR value — replace with actual from registration
    const qrValue = 'teranga:demo-badge-value';

    return Scaffold(
      appBar: AppBar(title: const Text('Mon Badge')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.08),
                    blurRadius: 20,
                    spreadRadius: 4,
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    color: AppTheme.navy,
                    child: const Center(
                      child: Text(
                        'Teranga Event',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  QrImageView(
                    data: qrValue,
                    version: QrVersions.auto,
                    size: 200,
                    errorCorrectionLevel: QrErrorCorrectLevel.H,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Participant',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                      color: AppTheme.navy,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Accès Standard',
                    style: TextStyle(color: Colors.grey, fontSize: 13),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () {
                // TODO: download PDF badge
              },
              icon: const Icon(Icons.download),
              label: const Text('Télécharger le badge PDF'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.gold,
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
