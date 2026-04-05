import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/models/event.dart';
import '../../../../core/theme/app_theme.dart';
import '../../providers/events_provider.dart';
import '../../../registration/providers/registration_provider.dart';

class EventDetailPage extends ConsumerWidget {
  const EventDetailPage({super.key, required this.eventId});
  final String eventId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventAsync = ref.watch(eventDetailProvider(eventId));

    return Scaffold(
      body: eventAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.red),
              const SizedBox(height: 12),
              const Text('Impossible de charger l\'événement'),
              TextButton(
                onPressed: () => ref.invalidate(eventDetailProvider(eventId)),
                child: const Text('Réessayer'),
              ),
            ],
          ),
        ),
        data: (event) => _EventDetailContent(event: event),
      ),
    );
  }
}

class _EventDetailContent extends ConsumerStatefulWidget {
  const _EventDetailContent({required this.event});
  final Event event;

  @override
  ConsumerState<_EventDetailContent> createState() => _EventDetailContentState();
}

class _EventDetailContentState extends ConsumerState<_EventDetailContent> {
  String? _selectedTicketId;
  bool _registering = false;

  @override
  void initState() {
    super.initState();
    final visibleTickets = widget.event.ticketTypes.where((t) => t.isVisible).toList();
    if (visibleTickets.isNotEmpty) {
      _selectedTicketId = visibleTickets.first.id;
    }
  }

  Future<void> _register() async {
    if (_selectedTicketId == null) return;
    setState(() => _registering = true);

    try {
      await ref.read(registrationNotifierProvider.notifier).register(
            eventId: widget.event.id,
            ticketTypeId: _selectedTicketId!,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Inscription réussie ! 🎉'),
            backgroundColor: AppTheme.green,
          ),
        );
        // Refresh event to update registered count
        ref.invalidate(eventDetailProvider(widget.event.id));
        ref.invalidate(eventsListProvider);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erreur: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _registering = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final event = widget.event;
    final dateFormat = DateFormat("EEEE d MMMM yyyy 'à' HH:mm", 'fr_FR');
    final startDate = DateTime.tryParse(event.startDate);
    final endDate = DateTime.tryParse(event.endDate);
    final visibleTickets = event.ticketTypes.where((t) => t.isVisible).toList();

    return CustomScrollView(
      slivers: [
        // ─── Cover image app bar ─────────────────────────────────────────
        SliverAppBar(
          expandedHeight: 220,
          pinned: true,
          flexibleSpace: FlexibleSpaceBar(
            title: Text(
              event.title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            background: Container(
              decoration: BoxDecoration(
                gradient: event.coverImageURL == null
                    ? const LinearGradient(
                        colors: [AppTheme.navy, AppTheme.lightNavy],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      )
                    : null,
                image: event.coverImageURL != null
                    ? DecorationImage(
                        image: NetworkImage(event.coverImageURL!),
                        fit: BoxFit.cover,
                      )
                    : null,
              ),
            ),
          ),
        ),

        SliverPadding(
          padding: const EdgeInsets.all(16),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              // ─── Tags ────────────────────────────────────────────────────
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: event.tags.map((tag) => Chip(
                  label: Text(tag, style: const TextStyle(fontSize: 12)),
                  visualDensity: VisualDensity.compact,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                )).toList(),
              ),
              const SizedBox(height: 16),

              // ─── Date & time ─────────────────────────────────────────────
              _InfoRow(
                icon: Icons.calendar_today,
                label: startDate != null ? dateFormat.format(startDate) : '-',
              ),
              if (endDate != null && startDate != null && endDate.day != startDate.day)
                _InfoRow(
                  icon: Icons.event,
                  label: 'Jusqu\'au ${dateFormat.format(endDate)}',
                ),
              const SizedBox(height: 8),

              // ─── Location ───────────────────────────────────────────────
              if (event.location != null) ...[
                _InfoRow(
                  icon: Icons.location_on,
                  label: event.location!.displayName,
                ),
                if (event.location!.address != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 32),
                    child: Text(
                      event.location!.address!,
                      style: const TextStyle(color: Colors.grey, fontSize: 13),
                    ),
                  ),
                const SizedBox(height: 8),
              ],

              // ─── Attendance ─────────────────────────────────────────────
              _InfoRow(
                icon: Icons.people,
                label: '${event.registeredCount} inscrits'
                    '${event.maxAttendees != null ? ' / ${event.maxAttendees} places' : ''}',
              ),
              const SizedBox(height: 20),

              // ─── Description ────────────────────────────────────────────
              const Text('À propos', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              const SizedBox(height: 8),
              Text(
                event.description,
                style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.black87),
              ),
              const SizedBox(height: 24),

              // ─── Ticket types ───────────────────────────────────────────
              if (visibleTickets.isNotEmpty) ...[
                const Text('Billets', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                const SizedBox(height: 12),
                ...visibleTickets.map((ticket) => _TicketCard(
                  ticket: ticket,
                  selected: _selectedTicketId == ticket.id,
                  onSelected: () => setState(() => _selectedTicketId = ticket.id),
                )),
                const SizedBox(height: 24),
              ],

              // ─── Register button ────────────────────────────────────────
              if (event.status == 'published')
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _registering || _selectedTicketId == null ? null : _register,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.gold,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _registering
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('S\'inscrire', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ),
                ),

              const SizedBox(height: 32),
            ]),
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppTheme.navy),
          const SizedBox(width: 10),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket, required this.selected, required this.onSelected});
  final TicketType ticket;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: ticket.isSoldOut ? null : onSelected,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          border: Border.all(
            color: selected ? AppTheme.gold : Colors.grey.shade300,
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
          color: ticket.isSoldOut ? Colors.grey.shade100 : Colors.white,
        ),
        child: Row(
          children: [
            Radio<bool>(
              value: true,
              groupValue: selected,
              onChanged: ticket.isSoldOut ? null : (_) => onSelected(),
              activeColor: AppTheme.gold,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    ticket.name,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                      color: ticket.isSoldOut ? Colors.grey : AppTheme.navy,
                    ),
                  ),
                  if (ticket.description != null)
                    Text(ticket.description!, style: const TextStyle(color: Colors.grey, fontSize: 13)),
                  if (ticket.remaining != null)
                    Text(
                      ticket.isSoldOut ? 'Complet' : '${ticket.remaining} places restantes',
                      style: TextStyle(
                        color: ticket.isSoldOut ? Colors.red : AppTheme.green,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                ],
              ),
            ),
            Text(
              ticket.price == 0 ? 'Gratuit' : '${ticket.price} XOF',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 15,
                color: ticket.price == 0 ? AppTheme.green : AppTheme.gold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
