import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileUpload } from "../file-upload";

const meta: Meta<typeof FileUpload> = {
  title: "Core Components/FileUpload",
  component: FileUpload,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Drop-zone + file picker with built-in size + MIME validation. " +
          "Localisable via `labels` (FR / EN / WO). Surfaces a French error " +
          "message when validation fails. Note: SVG uploads are intentionally " +
          "blocked at the API level (XSS vector — see CLAUDE.md security checklist).",
      },
    },
  },
  args: {
    onFileSelect: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof FileUpload>;

export const Default: Story = {
  args: {
    accept: "image/*",
    maxSizeMB: 5,
  },
};

export const WithDescription: Story = {
  args: {
    accept: "image/*",
    maxSizeMB: 5,
    description: "PNG, JPG ou WebP. 5 Mo maximum.",
  },
};

export const PdfOnly: Story = {
  name: "Restricted to PDF (10 Mo)",
  args: {
    accept: "application/pdf",
    maxSizeMB: 10,
    description: "PDF uniquement, 10 Mo maximum.",
  },
};

export const StrictSizeLimit: Story = {
  name: "Strict 1 Mo limit (will reject larger files)",
  args: {
    accept: "image/*",
    maxSizeMB: 1,
    description: "PNG, JPG ou WebP. 1 Mo maximum — pour les avatars.",
  },
};

export const EnglishLocale: Story = {
  args: {
    accept: "image/*",
    maxSizeMB: 5,
    labels: {
      dropzone: "Drop a file here, or click to browse",
      invalidType: "Unsupported file type",
      remove: "Remove",
    },
  },
};

export const AfterSelection: Story = {
  name: "Showcase: real-world wiring with live state",
  render: () => {
    const [filename, setFilename] = useState<string | null>(null);
    return (
      <div className="flex flex-col gap-3">
        <FileUpload
          accept="image/*"
          maxSizeMB={5}
          description="Image de couverture de l'événement (16:9 recommandé)."
          onFileSelect={(f) => setFilename(f.name)}
        />
        {filename && (
          <p className="text-sm text-muted-foreground" role="status">
            Fichier sélectionné : <span className="font-medium text-foreground">{filename}</span>
          </p>
        )}
      </div>
    );
  },
};
