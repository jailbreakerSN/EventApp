/// Event model matching the API response shape.
class Event {
  final String id;
  final String organizationId;
  final String title;
  final String slug;
  final String description;
  final String? shortDescription;
  final String? coverImageURL;
  final String category;
  final List<String> tags;
  final String format; // in_person, online, hybrid
  final String status; // draft, published, cancelled, archived
  final EventLocation? location;
  final String startDate;
  final String endDate;
  final String timezone;
  final List<TicketType> ticketTypes;
  final int? maxAttendees;
  final int registeredCount;
  final int checkedInCount;
  final bool isPublic;
  final bool isFeatured;
  final bool requiresApproval;
  final String createdAt;

  Event({
    required this.id,
    required this.organizationId,
    required this.title,
    required this.slug,
    required this.description,
    this.shortDescription,
    this.coverImageURL,
    required this.category,
    required this.tags,
    required this.format,
    required this.status,
    this.location,
    required this.startDate,
    required this.endDate,
    required this.timezone,
    required this.ticketTypes,
    this.maxAttendees,
    required this.registeredCount,
    required this.checkedInCount,
    required this.isPublic,
    required this.isFeatured,
    required this.requiresApproval,
    required this.createdAt,
  });

  factory Event.fromJson(Map<String, dynamic> json) {
    return Event(
      id: json['id'] as String,
      organizationId: json['organizationId'] as String,
      title: json['title'] as String,
      slug: json['slug'] as String? ?? '',
      description: json['description'] as String,
      shortDescription: json['shortDescription'] as String?,
      coverImageURL: json['coverImageURL'] as String?,
      category: json['category'] as String,
      tags: (json['tags'] as List<dynamic>?)?.cast<String>() ?? [],
      format: json['format'] as String? ?? 'in_person',
      status: json['status'] as String,
      location: json['location'] != null
          ? EventLocation.fromJson(json['location'] as Map<String, dynamic>)
          : null,
      startDate: json['startDate'] as String,
      endDate: json['endDate'] as String,
      timezone: json['timezone'] as String? ?? 'Africa/Dakar',
      ticketTypes: (json['ticketTypes'] as List<dynamic>?)
              ?.map((t) => TicketType.fromJson(t as Map<String, dynamic>))
              .toList() ??
          [],
      maxAttendees: json['maxAttendees'] as int?,
      registeredCount: json['registeredCount'] as int? ?? 0,
      checkedInCount: json['checkedInCount'] as int? ?? 0,
      isPublic: json['isPublic'] as bool? ?? true,
      isFeatured: json['isFeatured'] as bool? ?? false,
      requiresApproval: json['requiresApproval'] as bool? ?? false,
      createdAt: json['createdAt'] as String,
    );
  }

  /// Cheapest ticket price (0 means free).
  int get minPrice {
    if (ticketTypes.isEmpty) return 0;
    return ticketTypes.map((t) => t.price).reduce((a, b) => a < b ? a : b);
  }

  bool get isFree => minPrice == 0;
}

class EventLocation {
  final String? name;
  final String? address;
  final String? city;
  final String? country;
  final String? streamUrl;

  EventLocation({this.name, this.address, this.city, this.country, this.streamUrl});

  factory EventLocation.fromJson(Map<String, dynamic> json) {
    return EventLocation(
      name: json['name'] as String?,
      address: json['address'] as String?,
      city: json['city'] as String?,
      country: json['country'] as String?,
      streamUrl: json['streamUrl'] as String?,
    );
  }

  String get displayName {
    final parts = [name, city].where((s) => s != null && s.isNotEmpty);
    return parts.join(', ');
  }
}

class TicketType {
  final String id;
  final String name;
  final String? description;
  final int price;
  final String currency;
  final int? totalQuantity;
  final int soldCount;
  final bool isVisible;

  TicketType({
    required this.id,
    required this.name,
    this.description,
    required this.price,
    this.currency = 'XOF',
    this.totalQuantity,
    required this.soldCount,
    this.isVisible = true,
  });

  factory TicketType.fromJson(Map<String, dynamic> json) {
    return TicketType(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      price: json['price'] as int? ?? 0,
      currency: json['currency'] as String? ?? 'XOF',
      totalQuantity: json['totalQuantity'] as int?,
      soldCount: json['soldCount'] as int? ?? 0,
      isVisible: json['isVisible'] as bool? ?? true,
    );
  }

  bool get isSoldOut => totalQuantity != null && soldCount >= totalQuantity!;
  int? get remaining => totalQuantity != null ? totalQuantity! - soldCount : null;
}
