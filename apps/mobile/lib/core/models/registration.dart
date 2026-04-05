/// Registration model matching the API response shape.
class Registration {
  final String id;
  final String eventId;
  final String userId;
  final String ticketTypeId;
  final String status; // pending, confirmed, cancelled, checked_in
  final String? qrCodeValue;
  final String? checkedInAt;
  final String createdAt;
  final String updatedAt;

  // Denormalized fields (may come from API joins)
  final String? eventTitle;
  final String? eventStartDate;
  final String? ticketTypeName;

  Registration({
    required this.id,
    required this.eventId,
    required this.userId,
    required this.ticketTypeId,
    required this.status,
    this.qrCodeValue,
    this.checkedInAt,
    required this.createdAt,
    required this.updatedAt,
    this.eventTitle,
    this.eventStartDate,
    this.ticketTypeName,
  });

  factory Registration.fromJson(Map<String, dynamic> json) {
    return Registration(
      id: json['id'] as String,
      eventId: json['eventId'] as String,
      userId: json['userId'] as String,
      ticketTypeId: json['ticketTypeId'] as String,
      status: json['status'] as String,
      qrCodeValue: json['qrCodeValue'] as String?,
      checkedInAt: json['checkedInAt'] as String?,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
      eventTitle: json['eventTitle'] as String?,
      eventStartDate: json['eventStartDate'] as String?,
      ticketTypeName: json['ticketTypeName'] as String?,
    );
  }

  bool get isConfirmed => status == 'confirmed';
  bool get isPending => status == 'pending';
  bool get isCancelled => status == 'cancelled';
  bool get isCheckedIn => status == 'checked_in';
}
