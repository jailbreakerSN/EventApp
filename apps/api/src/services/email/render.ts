import { render } from "@react-email/render";
import type React from "react";

// Wrap react-email's render so every template produces the same triplet
// and call sites don't have to juggle async rendering twice (html + text).
// We always return a plain-text fallback — some corporate mail clients and
// every spam filter reward that. react-email derives it from the JSX, so
// there's no duplicated copy to keep in sync.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail(
  subject: string,
  element: React.ReactElement,
): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
