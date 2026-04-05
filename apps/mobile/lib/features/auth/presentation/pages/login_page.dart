import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_theme.dart';
import '../../providers/auth_provider.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    await ref.read(authNotifierProvider.notifier).login(
          _emailController.text.trim(),
          _passwordController.text,
        );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);

    ref.listen(authNotifierProvider, (_, state) {
      if (state is AsyncError) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Email ou mot de passe incorrect'),
            backgroundColor: Colors.red.shade600,
          ),
        );
      }
    });

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppTheme.navy, AppTheme.lightNavy],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Logo / Title
                  const Text(
                    'Teranga',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 40,
                      fontWeight: FontWeight.bold,
                      letterSpacing: -1,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    "L'Événementiel Africain, Connecté",
                    style: TextStyle(color: AppTheme.gold, fontSize: 12),
                  ),
                  const SizedBox(height: 40),

                  // Form card
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Connexion',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.navy,
                            ),
                          ),
                          const SizedBox(height: 20),

                          TextFormField(
                            controller: _emailController,
                            keyboardType: TextInputType.emailAddress,
                            decoration: const InputDecoration(
                              labelText: 'Adresse email',
                              prefixIcon: Icon(Icons.email_outlined),
                            ),
                            validator: (v) =>
                                v != null && v.contains('@') ? null : 'Email invalide',
                          ),
                          const SizedBox(height: 16),

                          TextFormField(
                            controller: _passwordController,
                            obscureText: _obscurePassword,
                            decoration: InputDecoration(
                              labelText: 'Mot de passe',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(_obscurePassword
                                    ? Icons.visibility_off
                                    : Icons.visibility),
                                onPressed: () => setState(
                                    () => _obscurePassword = !_obscurePassword),
                              ),
                            ),
                            validator: (v) =>
                                v != null && v.length >= 8 ? null : 'Min. 8 caractères',
                          ),
                          const SizedBox(height: 24),

                          ElevatedButton(
                            onPressed: authState.isLoading ? null : _login,
                            child: authState.isLoading
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Se connecter'),
                          ),
                          const SizedBox(height: 12),

                          Center(
                            child: TextButton(
                              onPressed: () => context.go('/auth/register'),
                              child: const Text('Pas encore de compte ? S\'inscrire'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
