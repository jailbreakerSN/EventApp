import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_theme.dart';

// TODO: implement EventsProvider using Riverpod + Firestore stream
class EventsListPage extends ConsumerWidget {
  const EventsListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Événements'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {},
          ),
          IconButton(
            icon: const Icon(Icons.filter_list),
            onPressed: () {},
          ),
        ],
      ),
      body: Column(
        children: [
          // Category filter chips
          _CategoryFilter(),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: 0, // TODO: connect to provider
              itemBuilder: (_, __) => const SizedBox.shrink(),
            ),
          ),
        ],
      ),
    );
  }
}

class _CategoryFilter extends StatefulWidget {
  @override
  State<_CategoryFilter> createState() => _CategoryFilterState();
}

class _CategoryFilterState extends State<_CategoryFilter> {
  String _selected = 'Tous';

  final _categories = [
    'Tous', 'Conférence', 'Concert', 'Workshop', 'Festival', 'Sport',
  ];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final cat = _categories[i];
          final selected = cat == _selected;
          return FilterChip(
            label: Text(cat),
            selected: selected,
            onSelected: (_) => setState(() => _selected = cat),
            selectedColor: AppTheme.navy,
            checkmarkColor: Colors.white,
            labelStyle: TextStyle(
              color: selected ? Colors.white : AppTheme.navy,
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            ),
          );
        },
      ),
    );
  }
}
