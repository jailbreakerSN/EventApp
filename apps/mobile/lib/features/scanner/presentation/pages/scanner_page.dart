import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

import '../../../../core/theme/app_theme.dart';

/// Staff QR Scanner page — works fully offline.
/// It validates QR codes against locally cached registration data.
class ScannerPage extends ConsumerStatefulWidget {
  const ScannerPage({super.key, required this.eventId});

  final String eventId;

  @override
  ConsumerState<ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends ConsumerState<ScannerPage> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );

  ScanResult? _lastResult;
  bool _processing = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onBarcodeDetected(BarcodeCapture capture) async {
    if (_processing) return;
    final rawValue = capture.barcodes.firstOrNull?.rawValue;
    if (rawValue == null) return;

    setState(() => _processing = true);

    final result = await _validateQr(rawValue);

    setState(() {
      _lastResult = result;
      _processing = false;
    });

    // Auto-reset after 3 seconds
    await Future.delayed(const Duration(seconds: 3));
    if (mounted) setState(() => _lastResult = null);
  }

  Future<ScanResult> _validateQr(String qrValue) async {
    final box = Hive.box('offlineEvents');
    final rawData = box.get(widget.eventId);

    if (rawData == null) {
      return ScanResult(
        valid: false,
        message: 'Données hors-ligne non disponibles. Synchronisez d\'abord.',
        color: Colors.orange,
      );
    }

    // Parse cached registrations
    final data = Map<String, dynamic>.from(rawData as Map);
    final registrations = (data['registrations'] as List).cast<Map>();

    final match = registrations.cast<Map<dynamic, dynamic>>().where(
      (r) => r['qrCodeValue'] == qrValue,
    ).firstOrNull;

    if (match == null) {
      return ScanResult(
        valid: false,
        message: 'QR code invalide ou non inscrit',
        color: Colors.red,
      );
    }

    if (match['checkedIn'] == true) {
      return ScanResult(
        valid: false,
        participantName: match['participantName'] as String?,
        message: 'Déjà scanné — ${match['ticketTypeName']}',
        color: Colors.orange,
      );
    }

    // Mark as checked in locally
    (data['registrations'] as List).cast<Map<dynamic, dynamic>>().forEach((r) {
      if (r['qrCodeValue'] == qrValue) {
        r['checkedIn'] = true;
        r['checkedInAt'] = DateTime.now().toIso8601String();
      }
    });
    await box.put(widget.eventId, data);

    // Queue for server sync
    await _queueCheckin(qrValue);

    return ScanResult(
      valid: true,
      participantName: match['participantName'] as String?,
      message: match['ticketTypeName'] as String? ?? 'Participant',
      color: AppTheme.green,
    );
  }

  Future<void> _queueCheckin(String qrValue) async {
    final queue = Hive.box('checkinQueue');
    final pending = List<Map>.from(
      (queue.get('pending') as List?)?.cast<Map>() ?? [],
    );
    pending.add({
      'qrValue': qrValue,
      'eventId': widget.eventId,
      'timestamp': DateTime.now().toIso8601String(),
    });
    await queue.put('pending', pending);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Scanner les badges'),
        backgroundColor: AppTheme.navy,
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on),
            onPressed: () => _controller.toggleTorch(),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onBarcodeDetected,
          ),

          // Scan overlay
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: AppTheme.gold, width: 3),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),

          // Result overlay
          if (_lastResult != null)
            Positioned(
              bottom: 40,
              left: 20,
              right: 20,
              child: _ResultCard(result: _lastResult!),
            ),

          // Offline indicator
          const Positioned(
            top: 10,
            right: 10,
            child: _OfflineIndicator(),
          ),
        ],
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});
  final ScanResult result;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: result.color,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: result.color.withOpacity(0.4),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(
            result.valid ? Icons.check_circle : Icons.cancel,
            color: Colors.white,
            size: 40,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (result.participantName != null)
                  Text(
                    result.participantName!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                Text(
                  result.message,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OfflineIndicator extends StatelessWidget {
  const _OfflineIndicator();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<ConnectivityResult>>(
      stream: Connectivity().onConnectivityChanged,
      builder: (context, snapshot) {
        final isOffline = snapshot.data?.every(
              (r) => r == ConnectivityResult.none,
            ) ??
            false;

        if (!isOffline) return const SizedBox.shrink();

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.orange,
            borderRadius: BorderRadius.circular(20),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.wifi_off, color: Colors.white, size: 14),
              SizedBox(width: 4),
              Text('Hors-ligne', style: TextStyle(color: Colors.white, fontSize: 12)),
            ],
          ),
        );
      },
    );
  }
}

class ScanResult {
  const ScanResult({
    required this.valid,
    required this.message,
    required this.color,
    this.participantName,
  });

  final bool valid;
  final String? participantName;
  final String message;
  final Color color;
}
