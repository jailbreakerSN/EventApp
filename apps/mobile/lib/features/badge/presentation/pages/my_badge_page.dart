import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../registration/providers/registration_provider.dart';

class MyBadgePage extends ConsumerWidget {
  const MyBadgePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final registrationsAsync = ref.watch(myRegistrationsProvider);
    final user = FirebaseAuth.instance.currentUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Mes Badges')),
      body: registrationsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.red),
              const SizedBox(height: 12),
              const Text('Impossible de charger vos badges'),
              TextButton(
                onPressed: () => ref.invalidate(myRegistrationsProvider),
                child: const Text('Réessayer'),
              ),
            ],
          ),
        ),
        data: (registrations) {
          final confirmed = registrations.where((r) => r.isConfirmed && r.qrCodeValue != null).toList();

          if (confirmed.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.qr_code, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text(
                    'Aucun badge disponible',
                    style: TextStyle(color: Colors.grey, fontSize: 16),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Inscrivez-vous à un événement pour obtenir\nvotre badge avec QR code.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey, fontSize: 13),
                  ),
                ],
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: confirmed.length,
            separatorBuilder: (_, __) => const SizedBox(height: 16),
            itemBuilder: (context, i) {
              final reg = confirmed[i];
              return _BadgeCard(
                eventTitle: reg.eventTitle ?? 'Événement',
                ticketName: reg.ticketTypeName ?? 'Billet',
                participantName: user?.displayName ?? 'Participant',
                qrValue: reg.qrCodeValue!,
              );
            },
          );
        },
      ),
    );
  }
}

class _BadgeCard extends StatelessWidget {
  const _BadgeCard({
    required this.eventTitle,
    required this.ticketName,
    required this.participantName,
    required this.qrValue,
  });

  final String eventTitle;
  final String ticketName;
  final String participantName;
  final String qrValue;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Event header
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
            decoration: const BoxDecoration(
              color: AppTheme.navy,
              borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
            ),
            child: Text(
              eventTitle,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
          ),
          const SizedBox(height: 20),

          // QR code
          QrImageView(
            data: qrValue,
            version: QrVersions.auto,
            size: 200,
            errorCorrectionLevel: QrErrorCorrectLevel.H,
          ),
          const SizedBox(height: 16),

          // Participant info
          Text(
            participantName,
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 18,
              color: AppTheme.navy,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            ticketName,
            style: const TextStyle(color: Colors.grey, fontSize: 13),
          ),
        ],
      ),
    );
  }
}
