// Hand-written content shapes mirroring the Payload globals/collection (the payload
// CLI's generate:types can't run in this toolchain). The data layer maps Payload's
// raw documents into these shapes, which the components already consume.

export type Card = { title: string; body: string };

export type DocSection = {
  label?: string;
  heading: string;
  paragraphs: string[];
  points?: string[];
};

export type Hero = {
  kicker: string;
  title: string;
  organizationLine: string;
  manifestoLine: string;
  body?: string;
};

export type DialogueEntry = {
  prompt: string;
  placeholder: string;
  submitLabel: string;
  note: string;
};

export type DialogueSuggestion = { label: string; value: string };

export type SectionBlock<Item> = { heading: string; intro: string; items: Item[] };

export type LifeScene = Card & { tags: string[] };

export type ContinueReadTarget = "manifesto" | "map" | "license";
export type ContinueRead = { label: string; description: string; target: ContinueReadTarget };

export type HomepageContent = {
  hero: Hero;
  dialogueEntry: DialogueEntry;
  dialogueSuggestions: DialogueSuggestion[];
  heroFlow: Card[];
  identity: SectionBlock<Card>;
  whyNow: SectionBlock<Card>;
  lifeScenes: SectionBlock<LifeScene>;
  direction: SectionBlock<Card>;
  selfRestraint: SectionBlock<Card>;
  continueReads: { heading: string; intro: string; items: ContinueRead[] };
};

export type ChatPageContent = { heading: string; intro: string };

// Everything the client-side chat component needs (it can't fetch server data itself).
export type DialogueChatContent = {
  heading: string;
  intro: string;
  suggestions: DialogueSuggestion[];
  brand: Brand;
  ui: UiStrings;
};

export type UiStrings = {
  backToHome: string;
  sendLabel: string;
  chatRestart: string;
  chatLoading: string;
  chatDisclaimer: string;
  chatAssistantName: string;
  chatUserName: string;
  chatPlaceholder: string;
  chatResetConfirm: string;
};

export type Brand = { wordmark: string; tagline: string; logoPath: string; logoAlt: string };

export type SiteSettings = {
  shareTitle: string;
  shareDescription: string;
  directionMapUrl: string;
  githubUrl: string;
  brand: Brand;
  headerNav: { label: string; href: string }[];
};

export type SocialChannelIcon = "douyin" | "kuaishou" | "bilibili";

export type FooterContent = {
  description: string;
  linksHeading: string;
  footerLinks: { label: string; href: string }[];
  channelsHeading: string;
  channels: {
    label: string;
    iconKey: SocialChannelIcon;
    status: string;
    description: string;
    qrPath?: string;
    qrAlt?: string;
  }[];
  githubLabel: string;
  beian?: string;
  copyright: string;
};

export type SiteDocument = {
  slug: ContinueReadTarget;
  eyebrow: string;
  title: string;
  summary: string;
  meta?: string;
  source?: string;
  guide?: string[];
  sections: DocSection[];
  closing?: string;
  fullTitle?: string;
  fullSections?: DocSection[];
};
