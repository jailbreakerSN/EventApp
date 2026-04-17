import type { Meta, StoryObj } from "@storybook/react";
import { TicketPass } from "../ticket-pass";

/**
 * In production, consumers pass a real QR via `props.qr` (e.g. `<QRCodeSVG/>`
 * from qrcode.react). Storybook doesn’t depend on qrcode.react, so we render
 * a deterministic 5×5 check pattern that visually mimics a QR code.
 */
function MockQR({ size = 116 }: { size?: number }) {
  const cells = 17;
  const cellSize = size / cells;
  const pattern: boolean[][] = Array.from({ length: cells }, (_, r) =>
    Array.from({ length: cells }, (_, c) => (r * 13 + c * 7 + r * c) % 3 === 0),
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Aperçu QR décoratif"
    >
      <rect width={size} height={size} fill="#ffffff" />
      {pattern.map((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="#1A1A2E"
            />
          ) : null,
        ),
      )}
      {/* Finder patterns in three corners */}
      {[
        [0, 0],
        [cells - 7, 0],
        [0, cells - 7],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect
            x={x * cellSize}
            y={y * cellSize}
            width={7 * cellSize}
            height={7 * cellSize}
            fill="#1A1A2E"
          />
          <rect
            x={(x + 1) * cellSize}
            y={(y + 1) * cellSize}
            width={5 * cellSize}
            height={5 * cellSize}
            fill="#ffffff"
          />
          <rect
            x={(x + 2) * cellSize}
            y={(y + 2) * cellSize}
            width={3 * cellSize}
            height={3 * cellSize}
            fill="#1A1A2E"
          />
        </g>
      ))}
    </svg>
  );
}

const meta: Meta<typeof TicketPass> = {
  title: "Editorial Primitives/TicketPass",
  component: TicketPass,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    // The navy pass is high-contrast by construction (white on navy) but the
    // gradient header can confuse axe — scope the automated color-contrast
    // check to only check the footer text.
    a11y: { config: {} },
  },
  args: {
    coverKey: "evt-dakar-tech-2026",
    kicker: "Admit One · Pass Nominatif",
    eventTitle: "Dakar Tech Summit 2026",
    fields: [
      { label: "Date", value: "14 mai 2026" },
      { label: "Pass", value: "Standard" },
      { label: "Zone", value: "Auditorium A" },
    ],
    codeLabel: "Code billet",
    codeValue: "TER-DKR-0001-5820",
    validAccessLabel: "ACCÈS VALIDE",
    holderLine: "Aminata Diallo · Pass Standard",
  },
  render: (args) => (
    <div style={{ width: 380 }}>
      <TicketPass {...args} qr={<MockQR />} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof TicketPass>;

export const StackFooter: Story = {
  name: "Stack footer (default, badge page)",
  args: {
    footerVariant: "stack",
    scanHint: "Scannez pour vous enregistrer à l’entrée",
  },
};

export const InlineFooter: Story = {
  name: "Inline footer (success step)",
  args: {
    footerVariant: "inline",
  },
};

export const WithOfflineHint: Story = {
  name: "With offline hint",
  args: {
    footerVariant: "stack",
    offlineHint: "⚡ Fonctionne hors ligne — aucune connexion requise",
    scanHint: "Scannez pour vous enregistrer à l’entrée",
  },
};

export const RevealAnimation: Story = {
  name: "animateReveal: true",
  args: {
    animateReveal: true,
    footerVariant: "inline",
  },
};

export const NoRevealAnimation: Story = {
  name: "animateReveal: false",
  args: {
    animateReveal: false,
    footerVariant: "stack",
  },
};

/**
 * The eight cover keys demonstrate the 8-palette gradient rotation. The
 * primitive hashes `coverKey` to pick a tint deterministically — same key
 * always produces the same header.
 */
export const GradientRotation: Story = {
  name: "8 coverKeys (gradient rotation)",
  parameters: { layout: "padded" },
  render: () => {
    const keys = [
      "evt-dakar-tech-2026",
      "evt-ramadan-majlis",
      "evt-saint-louis-jazz",
      "evt-thies-ag-tech",
      "evt-ziguinchor-culture",
      "evt-kaolack-startup",
      "evt-mbour-surf",
      "evt-touba-sciences",
    ];
    const titles = [
      "Dakar Tech Summit",
      "Ramadan Tech Majlis",
      "Saint-Louis Jazz Festival",
      "Thiès Ag-Tech Forum",
      "Ziguinchor Culture Week",
      "Kaolack Startup Nights",
      "Mbour Surf & Ocean",
      "Touba Sciences Humaines",
    ];
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {keys.map((k, i) => (
          <TicketPass
            key={k}
            coverKey={k}
            kicker="Admit One · Pass"
            eventTitle={titles[i]}
            fields={[
              { label: "Date", value: "14/05/26" },
              { label: "Pass", value: "Standard" },
            ]}
            qr={<MockQR size={92} />}
            codeLabel="Code"
            codeValue={`TER-${k.slice(-4).toUpperCase()}`}
            validAccessLabel="ACCÈS VALIDE"
            footerVariant="stack"
          />
        ))}
      </div>
    );
  },
};
