import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "../avatar";

const meta: Meta<typeof Avatar> = {
  title: "Core Components/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "User avatar with image fallback to initials. The `alt` prop is mandatory " +
          "for screen readers. When `src` fails to load, the `fallback` initials are " +
          "rendered with the muted-foreground tone.",
      },
    },
  },
  args: {
    fallback: "MD",
    alt: "Moussa Diop",
  },
};
export default meta;

type Story = StoryObj<typeof Avatar>;

export const Initials: Story = {
  args: { fallback: "MD" },
};

export const WithImage: Story = {
  args: {
    src: "https://i.pravatar.cc/120?img=12",
    alt: "Moussa Diop",
    fallback: "MD",
  },
};

export const ImageFailureFallback: Story = {
  name: "Image load failure → initials fallback",
  args: {
    src: "https://invalid.example.com/nonexistent.jpg",
    alt: "Aminata Fall",
    fallback: "AF",
  },
};

export const SizeSmall: Story = { args: { size: "sm", fallback: "SM" }, name: "Size: sm" };
export const SizeMedium: Story = { args: { size: "md", fallback: "MD" }, name: "Size: md (default)" };
export const SizeLarge: Story = { args: { size: "lg", fallback: "LG" }, name: "Size: lg" };

export const AllSizes: Story = {
  name: "All sizes side-by-side",
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex items-center gap-6">
      {(["sm", "md", "lg"] as const).map((size) => (
        <div key={size} className="text-center">
          <Avatar size={size} fallback={size.toUpperCase()} alt={`Avatar ${size}`} />
          <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {size}
          </p>
        </div>
      ))}
    </div>
  ),
};

export const ParticipantList: Story = {
  name: "Showcase: Participant list",
  parameters: { layout: "padded" },
  render: () => {
    const people = [
      { name: "Moussa Diop", initials: "MD", img: "https://i.pravatar.cc/120?img=12" },
      { name: "Fatou Sall", initials: "FS", img: "https://i.pravatar.cc/120?img=47" },
      { name: "Aminata Fall", initials: "AF", img: undefined },
      { name: "Cheikh Sow", initials: "CS", img: "https://i.pravatar.cc/120?img=33" },
    ];
    return (
      <ul className="flex flex-col gap-3">
        {people.map((p) => (
          <li key={p.name} className="flex items-center gap-3">
            <Avatar size="md" src={p.img} alt={p.name} fallback={p.initials} />
            <span className="text-sm">{p.name}</span>
          </li>
        ))}
      </ul>
    );
  },
};
