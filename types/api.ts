import type {
  AssocClass,
  ClassAttr,
  ClassCluster,
  Multiplicity,
  MultiplicityHint,
  Relation,
  RelationSuggestion,
  Snapshot,
  SnapshotInput,
  WizardState,
  Inheritance,
  AttrSuggestions,
  PromoteItem,
} from "./domain";

// === Convert API ===
export type ConvertRequest = {
  snapshots: Snapshot[];
  clusters?: ClassCluster[];
  classAttrs?: ClassAttr[];
  relations?: Relation[];
  assocClasses?: AssocClass[];
  multiplicities?: Multiplicity[];
  inheritance?: Inheritance[];
  decisionLog?: string[];
};

export type ConvertResponse = {
  declarationText: string;
  plantuml: string;
  warnings: string[];
  suggestions?: {
    clusters?: ClassCluster[];
    relations?: Relation[];
    multiplicityHints?: {
      key: string;
      counts: { snapshotId: string; aToB: number[]; bToA: number[] }[];
    }[];
  };
};

// === Object diagram PUML API ===
export type ObjectPumlResponse = {
  puml: string;
  encoded: string;
  urlSvg: string;
};

// === Compare API ===
export type CompareRequest = {
  snapshots: SnapshotInput[];
};

export type CompareResponse = {
  suggestions: {
    clusters: ClassCluster[];
    relations: RelationSuggestion[];
    multiplicityHints: MultiplicityHint[];
  };
};

// === Class diagram generation API ===
export type ClassPumlRequest = {
  wizard: WizardState;
};

export type ClassPumlResponse = {
  puml: string;
  urlSvg: string;
};

// === Attribute suggestion API ===
export type AttrSuggestRequest = {
  snapshots: SnapshotInput[];
  clusters: { className: string; instances: string[] }[];
};

export type AttrSuggestResponse = {
  suggestions: AttrSuggestions;
};

// === Attribute promotion API ===
export type AttrPromoteRequest = {
  wizard: WizardState;
};

export type AttrPromoteResponse = {
  suggestions: PromoteItem[];
};