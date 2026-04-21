import { type Dictionary } from "./dictionary";

export const en: Dictionary = {
  brand: {
    tagline: "Senegal's event management platform",
    footer: "Teranga Events — Senegal's event management platform",
  },
  common: {
    greeting: (name) => `Hello ${name},`,
    signoff: "The Teranga team",
    viewInApp: "View in app",
  },
  registrationConfirmation: {
    subject: (eventTitle) => `Registration confirmed — ${eventTitle}`,
    preview: (eventTitle) => `Your registration for ${eventTitle} is confirmed.`,
    heading: "Registration confirmed!",
    body: (eventTitle) => `Your registration for ${eventTitle} is confirmed.`,
    dateLabel: "Date",
    locationLabel: "Location",
    ticketLabel: "Ticket",
    downloadBadgeCta: "Download my badge",
    badgeInAppHint: "Your QR badge will be available in the app.",
  },
  registrationApproved: {
    subject: (eventTitle) => `Registration approved — ${eventTitle}`,
    preview: "Your registration has been approved by the organizer.",
    heading: "Registration approved!",
    body: (eventTitle) => `Your registration for ${eventTitle} has been approved by the organizer.`,
    dateLabel: "Date",
    locationLabel: "Location",
    downloadBadgeCta: "Download my badge",
    badgeInAppHint: "Your QR badge will be available in the app.",
  },
  badgeReady: {
    subject: (eventTitle) => `Your badge is ready — ${eventTitle}`,
    preview: "Your badge is ready to download.",
    heading: "Your badge is ready!",
    body: (eventTitle) => `Your badge for ${eventTitle} is ready to download.`,
    downloadBadgeCta: "Download my badge",
    badgeInAppHint: "Open the Teranga app to download your badge.",
  },
  eventReminder: {
    subject: (eventTitle, timeUntil) => `Reminder — ${eventTitle} ${timeUntil}`,
    preview: (eventTitle) => `${eventTitle} starts soon.`,
    heading: (timeUntil) => `Reminder: ${timeUntil}`,
    body: (eventTitle, timeUntil) => `${eventTitle} starts ${timeUntil}!`,
    dateLabel: "Date",
    locationLabel: "Location",
    dontForgetBadge: "Don't forget your QR badge!",
  },
  eventCancelled: {
    subject: (eventTitle) => `Event cancelled — ${eventTitle}`,
    preview: "An event you registered for has been cancelled.",
    heading: "Event cancelled",
    body: (eventTitle, eventDate) =>
      `We're sorry to inform you that ${eventTitle} scheduled for ${eventDate} has been cancelled.`,
    contactOrganizer: "If you have questions, please contact the event organizer.",
  },
  paymentReceipt: {
    subject: (amount) => `Payment receipt — ${amount}`,
    preview: (amount) => `We've received your payment of ${amount}.`,
    heading: "Payment confirmed",
    body: (amount, eventTitle) => `We've received your payment of ${amount} for ${eventTitle}.`,
    amountLabel: "Amount",
    eventLabel: "Event",
    receiptIdLabel: "Reference",
    dateLabel: "Date",
    thankYou: "Thank you for your trust. See you soon!",
  },
  welcomeNewsletter: {
    subject: "Welcome to Teranga Events!",
    preview: "Your newsletter subscription is confirmed.",
    heading: "Welcome!",
    body: "You're now subscribed to our newsletter.",
    closing: "You'll receive updates about upcoming events in Senegal and West Africa.",
    unsubscribeNote:
      "You're receiving this email because you subscribed to the Teranga Events newsletter. You can unsubscribe at any time.",
  },
  newsletterConfirmation: {
    subject: "Confirm your Teranga newsletter subscription",
    preview: "One more click to start receiving our event updates.",
    heading: "Confirm your subscription",
    body: "Thanks for your interest in Teranga Events! To complete your newsletter signup, please confirm your email address by clicking the button below.",
    ctaButton: "Confirm my subscription",
    expiryNote: "This link expires in 7 days.",
    didNotSubscribeNote:
      "If you didn't sign up, you can safely ignore this email — no subscription will be created without confirmation.",
    fallbackLine: (url) =>
      `If the button doesn't work, copy and paste this link into your browser: ${url}`,
  },
};
