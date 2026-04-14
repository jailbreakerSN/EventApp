"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@teranga/shared-ui";

/**
 * Event-detail tab navigation (ui-ux-pro-max rule 29).
 *
 * Wraps the 2-4 content sections of a public event detail page in a
 * Tabs component with URL-hash persistence (`#about`, `#speakers`,
 * `#sessions`, `#practical`). Keyboard: Arrow keys move between tabs
 * (shared-ui Tabs), Tab / Shift-Tab exits into content.
 *
 * Scroll-snap on < 640 px so the tab list reads edge-to-edge on phones.
 *
 * Children are rendered server-side by the parent page — React passes
 * them through as ReactNode. Only the active panel is visible after
 * hydration; initial HTML carries the active panel only (acceptable
 * given that SEO-critical schema lives in the JSON-LD emitted by
 * the server page).
 */
interface EventDetailTabsProps {
  about: React.ReactNode;
  speakers?: React.ReactNode;
  sessions?: React.ReactNode;
  practical?: React.ReactNode;
}

const TABS = ["about", "speakers", "sessions", "practical"] as const;
type TabValue = (typeof TABS)[number];

function isValidTab(v: string): v is TabValue {
  return (TABS as readonly string[]).includes(v);
}

export function EventDetailTabs({ about, speakers, sessions, practical }: EventDetailTabsProps) {
  const [tab, setTab] = useState<TabValue>("about");

  // Hydrate from URL hash on mount — this preserves a shared / copied
  // link like `.../events/slug#sessions` to the right tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    if (hash && isValidTab(hash)) setTab(hash);
  }, []);

  const handleChange = (v: string) => {
    if (!isValidTab(v)) return;
    setTab(v);
    if (typeof window !== "undefined") {
      // replaceState avoids polluting the back-button history with tab switches.
      history.replaceState(null, "", `#${v}`);
    }
  };

  return (
    <Tabs value={tab} onValueChange={handleChange} defaultValue="about" className="mt-8">
      <TabsList
        className="relative -mx-4 max-w-full gap-2 overflow-x-auto px-4 pb-1 snap-x snap-mandatory sm:mx-0 sm:px-1 sm:pb-0"
        aria-label="Sections de l'événement"
      >
        <TabsTrigger value="about" className="snap-start">
          À propos
        </TabsTrigger>
        {speakers && (
          <TabsTrigger value="speakers" className="snap-start">
            Intervenants
          </TabsTrigger>
        )}
        {sessions && (
          <TabsTrigger value="sessions" className="snap-start">
            Programme
          </TabsTrigger>
        )}
        {practical && (
          <TabsTrigger value="practical" className="snap-start">
            Pratique
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="about">{about}</TabsContent>
      {speakers && <TabsContent value="speakers">{speakers}</TabsContent>}
      {sessions && <TabsContent value="sessions">{sessions}</TabsContent>}
      {practical && <TabsContent value="practical">{practical}</TabsContent>}
    </Tabs>
  );
}
