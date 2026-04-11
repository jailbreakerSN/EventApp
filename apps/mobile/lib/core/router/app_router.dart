import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';
import '../../features/events/presentation/pages/events_list_page.dart';
import '../../features/events/presentation/pages/event_detail_page.dart';
import '../../features/badge/presentation/pages/my_badge_page.dart';
import '../../features/scanner/presentation/pages/scanner_page.dart';
import '../../features/feed/presentation/pages/feed_page.dart';
import '../../features/profile/presentation/pages/profile_page.dart';
import '../../features/networking/presentation/pages/networking_page.dart';
import '../shell/main_shell.dart';
import '../../features/auth/providers/auth_provider.dart';

part 'app_router.g.dart';

@riverpod
GoRouter appRouter(Ref ref) {
  final authState = ref.watch(authStateProvider);

  return GoRouter(
    initialLocation: '/events',
    redirect: (context, state) {
      final isLoggedIn = authState.valueOrNull != null;
      final isAuthRoute = state.matchedLocation.startsWith('/auth');

      if (!isLoggedIn && !isAuthRoute) return '/auth/login';
      if (isLoggedIn && isAuthRoute) return '/events';
      return null;
    },
    routes: [
      // ─── Auth routes ───────────────────────────────────────────────────
      GoRoute(
        path: '/auth/login',
        builder: (_, __) => const LoginPage(),
      ),
      GoRoute(
        path: '/auth/register',
        builder: (_, __) => const RegisterPage(),
      ),

      // ─── Main shell (bottom nav) ───────────────────────────────────────
      ShellRoute(
        builder: (context, state, child) => MainShell(child: child),
        routes: [
          GoRoute(
            path: '/events',
            builder: (_, __) => const EventsListPage(),
            routes: [
              GoRoute(
                path: ':eventId',
                builder: (_, state) =>
                    EventDetailPage(eventId: state.pathParameters['eventId']!),
              ),
            ],
          ),
          GoRoute(
            path: '/feed',
            builder: (_, __) => const FeedPage(),
          ),
          GoRoute(
            path: '/networking',
            builder: (_, __) => const NetworkingPage(),
          ),
          GoRoute(
            path: '/badge',
            builder: (_, __) => const MyBadgePage(),
          ),
          GoRoute(
            path: '/profile',
            builder: (_, __) => const ProfilePage(),
          ),
        ],
      ),

      // ─── Staff Scanner (standalone, no bottom nav) ─────────────────────
      GoRoute(
        path: '/scanner/:eventId',
        builder: (_, state) =>
            ScannerPage(eventId: state.pathParameters['eventId']!),
      ),
    ],
  );
}
