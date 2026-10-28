export type HelpSection = {
  id: string;
  group: string;
  title: string;
  summary: string;
  route?: string;
  howTo: string[];
  rules: string[];
};
