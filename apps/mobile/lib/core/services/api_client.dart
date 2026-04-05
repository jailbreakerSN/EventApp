import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'api_client.g.dart';

/// Base URL for the Teranga API.
/// Android emulator uses 10.0.2.2 to reach host machine.
/// Physical device or iOS simulator should use actual LAN IP.
const String _baseUrl = kDebugMode ? 'http://10.0.2.2:3000' : 'https://api.teranga.events';

@riverpod
Dio dio(Ref ref) {
  final dio = Dio(BaseOptions(
    baseUrl: _baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'Content-Type': 'application/json'},
  ));

  // Auth interceptor: inject Firebase ID token
  dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) async {
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        final token = await user.getIdToken();
        options.headers['Authorization'] = 'Bearer $token';
      }
      return handler.next(options);
    },
    onError: (error, handler) {
      debugPrint('API Error: ${error.response?.statusCode} ${error.requestOptions.path}');
      return handler.next(error);
    },
  ));

  if (kDebugMode) {
    dio.interceptors.add(LogInterceptor(
      requestBody: false,
      responseBody: true,
      logPrint: (o) => debugPrint('📡 $o'),
    ));
  }

  return dio;
}

@riverpod
ApiClient apiClient(Ref ref) {
  return ApiClient(ref.watch(dioProvider));
}

/// Typed API client wrapping Dio for Teranga REST endpoints.
class ApiClient {
  final Dio _dio;
  ApiClient(this._dio);

  // ─── Events ──────��───────────────────────────────────────────────────────

  Future<Map<String, dynamic>> searchEvents({
    String? q,
    String? category,
    int page = 1,
    int limit = 20,
  }) async {
    final params = <String, dynamic>{
      'page': page,
      'limit': limit,
    };
    if (q != null && q.isNotEmpty) params['q'] = q;
    if (category != null && category.isNotEmpty) params['category'] = category;

    final res = await _dio.get('/v1/events', queryParameters: params);
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getEvent(String id) async {
    final res = await _dio.get('/v1/events/$id');
    return res.data as Map<String, dynamic>;
  }

  // ─── Registrations ─────────���─────────────────────────────────────────────

  Future<Map<String, dynamic>> createRegistration({
    required String eventId,
    required String ticketTypeId,
  }) async {
    final res = await _dio.post('/v1/registrations', data: {
      'eventId': eventId,
      'ticketTypeId': ticketTypeId,
    });
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getMyRegistrations({
    int page = 1,
    int limit = 20,
  }) async {
    final res = await _dio.get('/v1/registrations/me', queryParameters: {
      'page': page,
      'limit': limit,
    });
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> cancelRegistration(String id) async {
    final res = await _dio.post('/v1/registrations/$id/cancel');
    return res.data as Map<String, dynamic>;
  }

  // ─── Badges ──���───────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getMyBadges() async {
    final res = await _dio.get('/v1/badges/me');
    return res.data as Map<String, dynamic>;
  }

  // ─── User Profile ─────���──────────────────────────────────────────────────

  Future<Map<String, dynamic>> getMyProfile() async {
    final res = await _dio.get('/v1/users/me');
    return res.data as Map<String, dynamic>;
  }
}
