import { type Dictionary } from "./dictionary";

// Wolof translations — first pass. Wolof naturally code-switches with
// French for modern/technical vocabulary; we keep French loanwords where
// that's how speakers actually say it. A native reviewer should sanity-check
// the phrasing before production rollout. Missing keys fall back to French
// (via pickDict), so the worst case is a mixed-language email rather than
// a broken one.
export const wo: Dictionary = {
  lang: "wo",
  brand: {
    tagline: "Plateforme u événement ci Senegaal",
    footer: "Teranga Events — Plateforme u événement ci Senegaal",
  },
  common: {
    greeting: (name) => `Asalaa maalekum ${name},`,
    signoff: "Équipe Teranga",
    viewInApp: "Xool ci application bi",
  },
  registrationConfirmation: {
    subject: (eventTitle) => `Inscription bi dafa dëgër — ${eventTitle}`,
    preview: (eventTitle) => `Sa inscription ci ${eventTitle} dafa wér.`,
    heading: "Inscription bi dafa dëgër !",
    body: (eventTitle) => `Sa inscription ci ${eventTitle} dafa wér.`,
    dateLabel: "Bés",
    locationLabel: "Béreb",
    ticketLabel: "Ticket",
    downloadBadgeCta: "Yéegal badge bi",
    badgeInAppHint: "Sa badge QR dina am ci application bi.",
  },
  registrationApproved: {
    subject: (eventTitle) => `Inscription bi nangu nañu — ${eventTitle}`,
    preview: "Sa inscription nangu nañu ko ci organisateur bi.",
    heading: "Inscription bi nangu nañu !",
    body: (eventTitle) => `Sa inscription ci ${eventTitle} nangu nañu ko ci organisateur bi.`,
    dateLabel: "Bés",
    locationLabel: "Béreb",
    downloadBadgeCta: "Yéegal badge bi",
    badgeInAppHint: "Sa badge QR dina am ci application bi.",
  },
  badgeReady: {
    subject: (eventTitle) => `Sa badge dafa waaj — ${eventTitle}`,
    preview: "Sa badge dafa waaj ngir yéeg.",
    heading: "Sa badge dafa waaj !",
    body: (eventTitle) => `Sa badge ngir ${eventTitle} dafa waaj ngir yéeg.`,
    downloadBadgeCta: "Yéegal badge bi",
    badgeInAppHint: "Ubbil application Teranga ngir yéeg sa badge.",
  },
  eventReminder: {
    subject: (eventTitle, timeUntil) => `Fàttaliku — ${eventTitle} ${timeUntil}`,
    preview: (eventTitle) => `${eventTitle} dina tàmbali léegi léegi.`,
    heading: (timeUntil) => `Fàttaliku : ${timeUntil}`,
    body: (eventTitle, timeUntil) => `${eventTitle} dina tàmbali ${timeUntil} !`,
    dateLabel: "Bés",
    locationLabel: "Béreb",
    dontForgetBadge: "Bu fàtte sa badge QR !",
  },
  eventCancelled: {
    subject: (eventTitle) => `Événement bi neenaw na — ${eventTitle}`,
    preview: "Benn événement bi nga inscrire ci dafa neenaw.",
    heading: "Événement neenaw na",
    body: (eventTitle, eventDate) =>
      `Baal nu, événement ${eventTitle} bi waroon am ci ${eventDate} neenaw nañu ko.`,
    contactOrganizer: "Su nga am laaj, jokkoo ak organisateur bi ci événement bi.",
  },
  paymentReceipt: {
    subject: (amount) => `Reçu paiement — ${amount}`,
    preview: (amount) => `Jot nanu sa paiement ${amount}.`,
    heading: "Paiement bi nangu nañu",
    body: (amount, eventTitle) => `Jot nanu sa paiement ${amount} ngir ${eventTitle}.`,
    amountLabel: "Njëg",
    eventLabel: "Événement",
    receiptIdLabel: "Référence",
    dateLabel: "Bés",
    thankYou: "Jërëjëf ci sa kóllëre. Ba beneen yoon !",
  },
  welcomeNewsletter: {
    subject: "Dalal jàmm ci Teranga Events !",
    preview: "Sa inscription ci newsletter bi dafa wér.",
    heading: "Dalal jàmm !",
    body: "Inscrire nga ci sunu newsletter.",
    closing: "Dinga jot xibaar ci événement yi di ñëw ci Senegaal ak ci sowwu Afrik.",
    unsubscribeNote:
      "Jot nga e-mail bi ndax inscrire nga ci newsletter Teranga Events. Mën nga a désinscrire sa bopp ci saa bu nekk.",
    // Wolof code-switches with French on technical vocabulary — "désinscrire"
    // is how speakers actually say "unsubscribe" in conversation. Native
    // reviewer can swap for a more indigenous phrasing if preferred.
    unsubscribeLinkLabel: "Désinscrire",
  },
  newsletterConfirmation: {
    subject: "Wéral sa inscription ci newsletter Teranga",
    preview: "Benn clic ci mujj ngir jot sunu xibaar yi.",
    heading: "Wéral sa inscription",
    body: "Jërëjëf ci sa intérêt ci Teranga Events ! Ngir mujj sa inscription ci newsletter bi, wéral sa adresse e-mail ci bouton bi ci suuf.",
    ctaButton: "Wéral sa inscription",
    expiryNote: "Lien bii dafay jog ci 7 fan.",
    didNotSubscribeNote:
      "Soo dul kii defoon ndeme bii, dara bul ci def — amul inscription bu ñu defloo sa wéral.",
    fallbackLine: (url) => `Su bouton bi du liggéey, kopi lien bii ci sa navigateur : ${url}`,
  },
};
