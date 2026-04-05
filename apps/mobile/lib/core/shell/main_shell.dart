import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_theme.dart';

class MainShell extends StatelessWidget {
  const MainShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;

    return Scaffold(
      body: child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _indexFor(location),
        onTap: (i) => _navigate(context, i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.event), label: 'Événements'),
          BottomNavigationBarItem(icon: Icon(Icons.feed), label: 'Fil'),
          BottomNavigationBarItem(icon: Icon(Icons.people), label: 'Réseau'),
          BottomNavigationBarItem(icon: Icon(Icons.qr_code), label: 'Badge'),
          BottomNavigationBarItem(icon: Icon(Icons.person), label: 'Profil'),
        ],
      ),
    );
  }

  int _indexFor(String location) {
    if (location.startsWith('/events')) return 0;
    if (location.startsWith('/feed')) return 1;
    if (location.startsWith('/networking')) return 2;
    if (location.startsWith('/badge')) return 3;
    return 4;
  }

  void _navigate(BuildContext context, int index) {
    switch (index) {
      case 0: context.go('/events');
      case 1: context.go('/feed');
      case 2: context.go('/networking');
      case 3: context.go('/badge');
      case 4: context.go('/profile');
    }
  }
}
